import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    ImageSubmissionDB,
    KarmaDB,
    NonceDB,
    PrivacyDB,
    VerificationAuditDB,
} from '../src/db-helpers';
import {
    applyValidSubmissionBonus,
    calculateNewScore,
    canUserSubmit,
    escalatePenalty,
    getTierFromScore,
} from '../src/karma-service';
import { createNonceRecord, isNonceFresh } from '../src/nonce-service';
import {
    canDecryptUserIds,
    canReadSubmission,
    filterImageSubmissionByRole,
} from '../src/privacy-service';
import {
    generatePerceptualHash,
    performVerification,
    validateGeofence,
    validateTimestamp
} from '../src/verification-service';
import { Pool } from './cassandra-adapter';

/**
 * Integration Tests for Image Submission System
 */

describe('Image Submission System', () => {
  let pool: Pool | undefined;
  let imageDb: ImageSubmissionDB | undefined;
  let karmaDb: KarmaDB | undefined;
  let auditDb: VerificationAuditDB | undefined;
  let nonceDb: NonceDB | undefined;
  let privacyDb: PrivacyDB | undefined;

  const TEST_USER_ID = 'user-123';
  const TEST_REQUEST_ID = 'request-456';

  beforeAll(async () => {
    // Prefer Cassandra environment; fallback to legacy DATABASE_URL for compatibility
    const cass = process.env.CASSANDRA_CONTACT_POINTS;
    const legacy = process.env.DATABASE_URL;

    if (!cass && !legacy) {
      return;
    }

    if (cass) {
      pool = new Pool({
        contactPoints: cass.split(','),
        keyspace: process.env.CASSANDRA_KEYSPACE || 'roadwatch',
        localDc: process.env.CASSANDRA_LOCAL_DC || 'datacenter1'
      } as any);
    } else {
      // Legacy Postgres connection path (test compatibility)
      pool = new Pool({
        connectionString: legacy,
      } as any);
    }

    imageDb = new ImageSubmissionDB(pool);
    karmaDb = new KarmaDB(pool);
    auditDb = new VerificationAuditDB(pool);
    nonceDb = new NonceDB(pool);
    privacyDb = new PrivacyDB(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  describe('Nonce Generation and Validation', () => {
    it('should generate a valid nonce with expiration', () => {
      const config = {
        ttl_seconds: 300,
        nonce_length_bytes: 32,
      };

      const nonce = createNonceRecord(TEST_USER_ID, TEST_REQUEST_ID, config);

      expect(nonce.nonce).toBeDefined();
      expect(nonce.nonce.length).toBe(64); // 32 bytes = 64 hex chars
      expect(nonce.expires_at).toBeGreaterThan(nonce.issued_at);
      expect(nonce.expires_at - nonce.issued_at).toBe(config.ttl_seconds * 1000);
    });

    it('should validate fresh nonce', () => {
      const now = Date.now();
      const issuedAt = now - 60000; // 1 minute ago
      const expiresAt = now + 240000; // 4 minutes from now

      expect(isNonceFresh(issuedAt, expiresAt, now)).toBe(true);
    });

    it('should reject expired nonce', () => {
      const now = Date.now();
      const expiresAt = now - 1000; // expired 1 second ago

      expect(isNonceFresh(now - 2000, expiresAt, now)).toBe(false);
    });
  });

  describe('Image Verification', () => {
    it('should validate timestamp within window', () => {
      const serverTime = Date.now();
      const exifTime = serverTime - 60000; // 1 minute old
      const timeWindow = 10 * 60 * 1000; // 10 minutes

      const check = validateTimestamp(exifTime, serverTime, timeWindow);

      expect(check.passed).toBe(true);
      expect(check.name).toBe('exif_time_validation');
    });

    it('should reject stale image (timestamp too old)', () => {
      const serverTime = Date.now();
      const exifTime = serverTime - 15 * 60 * 1000; // 15 minutes old
      const timeWindow = 10 * 60 * 1000; // 10 minutes

      const check = validateTimestamp(exifTime, serverTime, timeWindow);

      expect(check.passed).toBe(false);
    });

    it('should validate geofence', () => {
      const requestedLat = 28.7041;
      const requestedLng = 77.1025; // Delhi

      const check = validateGeofence(
        requestedLat,
        requestedLng,
        undefined,
        undefined,
        requestedLat,
        requestedLng,
        100 // 100 meters
      );

      expect(check.passed).toBe(true);
    });

    it('should reject location outside geofence', () => {
      const requestedLat = 28.7041;
      const requestedLng = 77.1025; // Delhi

      // Bangalore coordinates (far from Delhi)
      const imageLat = 12.9716;
      const imageLng = 77.5946;

      const check = validateGeofence(
        imageLat,
        imageLng,
        undefined,
        undefined,
        requestedLat,
        requestedLng,
        100 // 100 meters
      );

      expect(check.passed).toBe(false);
    });

    it('should generate consistent perceptual hash', () => {
      const imageBuffer = Buffer.from('test image data 12345');
      const hash1 = generatePerceptualHash(imageBuffer);
      const hash2 = generatePerceptualHash(imageBuffer);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBeGreaterThan(0);
    });
  });

  describe('Karma System', () => {
    it('should initialize user with standard karma tier', async () => {
      if (!karmaDb) {
        return;
      }

      const karma = await karmaDb.getOrCreateRecord(TEST_USER_ID, 100);

      expect(karma.user_id).toBe(TEST_USER_ID);
      expect(karma.score).toBe(100);
      expect(karma.tier).toBe('Standard');
      expect(karma.penalty_count).toBe(0);
    });

    it('should apply valid submission bonus', () => {
      const config = {
        valid_submission_bonus: 10,
        flagged_penalty: -50,
        duplicate_penalty: -30,
        rejected_penalty: -75,
        appeal_success_restore: 30,
        daily_submission_limit: 10,
        suspension_threshold_score: -100,
        ban_threshold_penalty_count: 3,
        initial_score: 100,
      };

      const karma = {
        id: 'karma-1',
        user_id: TEST_USER_ID,
        score: 100,
        tier: 'Standard' as const,
        penalty_count: 0,
        suspended_until: 0,
        daily_submission_count: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_penalty_at: undefined,
        ban_reason: undefined,
      };

      const bonus = applyValidSubmissionBonus(karma, config);
      const newScore = calculateNewScore(karma.score, bonus);

      expect(bonus.delta).toBe(10);
      expect(newScore).toBe(110);
    });

    it('should determine tier based on score', () => {
      expect(getTierFromScore(550, 0, 0)).toBe('Trusted');
      expect(getTierFromScore(150, 0, 0)).toBe('Standard');
      expect(getTierFromScore(50, 0, 0)).toBe('AtRisk');
      expect(getTierFromScore(-50, 0, 0)).toBe('Suspended');
    });

    it('should escalate penalties correctly', () => {
      const config = {
        valid_submission_bonus: 10,
        flagged_penalty: -50,
        duplicate_penalty: -30,
        rejected_penalty: -75,
        appeal_success_restore: 30,
        daily_submission_limit: 10,
        suspension_threshold_score: -100,
        ban_threshold_penalty_count: 3,
        initial_score: 100,
      };

      const karma = {
        id: 'karma-2',
        user_id: TEST_USER_ID,
        score: 50,
        tier: 'AtRisk' as const,
        penalty_count: 0,
        suspended_until: 0,
        daily_submission_count: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_penalty_at: undefined,
        ban_reason: undefined,
      };

      // 1st offense
      let escalation = escalatePenalty(karma, config);
      expect(escalation.newPenaltyCount).toBe(1);
      expect(escalation.suspendedUntil).toBe(0); // No suspension for 1st

      // 2nd offense
      karma.penalty_count = 1;
      escalation = escalatePenalty(karma, config);
      expect(escalation.newPenaltyCount).toBe(2);
      expect(escalation.suspendedUntil).toBeGreaterThan(Date.now()); // 7 days

      // 3rd offense
      karma.penalty_count = 2;
      escalation = escalatePenalty(karma, config);
      expect(escalation.newPenaltyCount).toBe(3);
      expect(escalation.shouldBan).toBe(true);
    });

    it('should check submission eligibility based on karma', () => {
      const config = {
        valid_submission_bonus: 10,
        flagged_penalty: -50,
        duplicate_penalty: -30,
        rejected_penalty: -75,
        appeal_success_restore: 30,
        daily_submission_limit: 10,
        suspension_threshold_score: -100,
        ban_threshold_penalty_count: 3,
        initial_score: 100,
      };

      const bannedKarma = {
        id: 'karma-3',
        user_id: TEST_USER_ID,
        score: -200,
        tier: 'Banned' as const,
        penalty_count: 3,
        suspended_until: 0,
        daily_submission_count: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_penalty_at: undefined,
        ban_reason: 'Permanent ban',
      };

      const result = canUserSubmit(bannedKarma, config, undefined);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('banned');
    });
  });

  describe('Privacy & RBAC', () => {
    it('should filter submission fields by role', () => {
      const submission = {
        id: 'sub-123',
        request_id: TEST_REQUEST_ID,
        uploader_id_encrypted: Buffer.from('encrypted_id'),
        uploader_pseudonym: 'Citizen#ABC123',
        server_received_at: Date.now(),
        exif_timestamp: Date.now() - 60000,
        exif_latitude: 28.7041,
        exif_longitude: 77.1025,
        device_latitude: 28.7041,
        device_longitude: 77.1025,
        nonce: 'abc123',
        phash: 'phash123',
        verified_status: 'Verified' as const,
        storage_path: '/submissions/sub-123.jpg',
        metadata: {},
        created_at: Date.now(),
        created_by_id: TEST_USER_ID,
      };

      // Admin sees everything
      const adminContext = {
        user_id: 'admin-1',
        roles: ['admin' as const],
      };

      const adminFiltered = filterImageSubmissionByRole(submission, adminContext);
      expect(adminFiltered.uploader_id_encrypted).toBeDefined();
      expect(adminFiltered.nonce).toBeDefined();

      // Authority hides user ID
      const authorityContext = {
        user_id: 'authority-1',
        roles: ['authority' as const],
      };

      const authorityFiltered = filterImageSubmissionByRole(submission, authorityContext);
      expect(authorityFiltered.uploader_id_encrypted).toBeUndefined();
      expect(authorityFiltered.nonce).toBeUndefined();
      expect(authorityFiltered.exif_latitude).toBeDefined(); // But can see location

      // Citizen sees only their own
      const citizenContext = {
        user_id: TEST_USER_ID,
        roles: ['citizen' as const],
      };

      const citizenFiltered = filterImageSubmissionByRole(submission, citizenContext);
      expect(citizenFiltered.uploader_id_encrypted).toBeDefined();
    });

    it('should enforce read access control', () => {
      const submission = {
        id: 'sub-123',
        request_id: TEST_REQUEST_ID,
        uploader_id_encrypted: Buffer.from('encrypted_id'),
        uploader_pseudonym: 'Citizen#ABC123',
        server_received_at: Date.now(),
        exif_timestamp: undefined,
        exif_latitude: undefined,
        exif_longitude: undefined,
        device_latitude: undefined,
        device_longitude: undefined,
        nonce: 'abc123',
        phash: undefined,
        verified_status: 'Verified' as const,
        storage_path: '/submissions/sub-123.jpg',
        metadata: {},
        created_at: Date.now(),
        created_by_id: TEST_USER_ID,
      };

      // Citizens can read their own
      const citizenContext = {
        user_id: TEST_USER_ID,
        roles: ['citizen' as const],
      };

      let result = canReadSubmission(submission, citizenContext);
      expect(result.allowed).toBe(true);

      // Citizens cannot read others'
      const otherCitizenContext = {
        user_id: 'other-user',
        roles: ['citizen' as const],
      };

      result = canReadSubmission(submission, otherCitizenContext);
      expect(result.allowed).toBe(false);

      // Admin can read everything
      const adminContext = {
        user_id: 'admin-1',
        roles: ['admin' as const],
      };

      result = canReadSubmission(submission, adminContext);
      expect(result.allowed).toBe(true);
    });

    it('should restrict user ID decryption to admins only', () => {
      const adminContext = {
        user_id: 'admin-1',
        roles: ['admin' as const],
      };

      const citizenContext = {
        user_id: 'citizen-1',
        roles: ['citizen' as const],
      };

      expect(canDecryptUserIds(adminContext)).toBe(true);
      expect(canDecryptUserIds(citizenContext)).toBe(false);
    });
  });

  describe('Full Submission Flow', () => {
    it('should process complete submission with verification', async () => {
      // 1. Generate nonce
      const nonce = createNonceRecord(TEST_USER_ID, TEST_REQUEST_ID, {
        ttl_seconds: 300,
        nonce_length_bytes: 32,
      });

      // 2. Create image buffer
      const imageBuffer = Buffer.from('fake image data');

      // 3. Perform verification
      const verification = await performVerification(
        imageBuffer,
        Date.now() - 60000, // 1 minute old EXIF
        28.7041,
        77.1025,
        28.7041,
        77.1025,
        nonce.nonce,
        nonce.nonce,
        28.7041,
        77.1025,
        [],
        {
          time_window_ms: 10 * 60 * 1000,
          geofence_radius_meters: 50,
          phash_threshold: 10,
        }
      );

      expect(verification.checks.length).toBeGreaterThan(0);
      expect(verification.passed).toBe(true);
    });
  });
});
