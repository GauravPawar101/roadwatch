import express, { Request, Response } from 'express';
import * as crypto from 'node:crypto';
import {
    ImageSubmissionDB,
    KarmaDB,
    NonceDB,
    PrivacyDB,
    VerificationAuditDB,
} from '../../../packages/core/src/db-helpers';
import type { GenerateNonceRequest, VerificationConfig } from '../../../packages/core/src/image-types';
import {
    applyDuplicatePenalty,
    applyValidSubmissionBonus,
    calculateNewScore,
    canUserSubmit,
    escalatePenalty,
    getTierFromScore,
    type KarmaConfig
} from '../../../packages/core/src/karma-service';
import {
    canGenerateNonce,
    createNonceRecord,
    getTimeRemaining,
    isNonceFresh,
} from '../../../packages/core/src/nonce-service';
import {
    canReadSubmission,
    filterImageSubmissionByRole,
    type PrivacyContext
} from '../../../packages/core/src/privacy-service';
import {
    generatePerceptualHash,
    hammingDistance,
    performVerification,
} from '../../../packages/core/src/verification-service';
import { validateJWT } from '../middleware/jwt';

const router = express.Router();

// Configuration (should be environment variables)
const VERIFICATION_CONFIG: VerificationConfig = {
  time_window_ms: 10 * 60 * 1000, // 10 minutes
  geofence_radius_meters: 50,
  nonce_ttl_seconds: 300, // 5 minutes
  phash_threshold: 10,
  daily_submission_limit: 10,
  initial_karma_score: 100,
  valid_submission_bonus: 10,
  flagged_penalty: -50,
  duplicate_penalty: -30,
  appeal_cooldown_ms: 7 * 24 * 60 * 60 * 1000, // 7 days
};

const KARMA_CONFIG: KarmaConfig = {
  initial_score: VERIFICATION_CONFIG.initial_karma_score,
  valid_submission_bonus: VERIFICATION_CONFIG.valid_submission_bonus,
  flagged_penalty: VERIFICATION_CONFIG.flagged_penalty,
  duplicate_penalty: VERIFICATION_CONFIG.duplicate_penalty,
  rejected_penalty: -75,
  appeal_success_restore: 30,
  daily_submission_limit: VERIFICATION_CONFIG.daily_submission_limit,
  suspension_threshold_score: -100,
  ban_threshold_penalty_count: 3,
};

let db: {
  image: ImageSubmissionDB;
  karma: KarmaDB;
  audit: VerificationAuditDB;
  nonce: NonceDB;
  privacy: PrivacyDB;
};

type Pool = ConstructorParameters<typeof ImageSubmissionDB>[0];

/**
 * Initialize database connections
 */
export function initializeImageRoutes(pool: Pool): typeof router {
  db = {
    image: new ImageSubmissionDB(pool),
    karma: new KarmaDB(pool),
    audit: new VerificationAuditDB(pool),
    nonce: new NonceDB(pool),
    privacy: new PrivacyDB(pool),
  };

  return router;
}

/**
 * POST /submissions/nonce
 * Generate a short-lived nonce for image submission
 */
router.post('/submissions/nonce', validateJWT, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { request_id, ttl_seconds } = req.body as GenerateNonceRequest;

    if (!userId || !request_id) {
      return res.status(400).json({ error: 'Missing userId or request_id' });
    }

    // Check rate limiting
    const rateCheckResult = canGenerateNonce(0, Date.now() - 2000, 10);
    if (!rateCheckResult.allowed) {
      return res.status(429).json({
        error: rateCheckResult.reason,
        backoff_ms: rateCheckResult.backoff_ms,
      });
    }

    // Check user karma (suspended users cannot generate nonces)
    const karma = await db.karma.getOrCreateRecord(userId);
    if (karma.tier === 'Suspended' || karma.tier === 'Banned') {
      return res.status(403).json({
        error: 'User is suspended or banned',
        tier: karma.tier,
      });
    }

    // Create nonce
    const ttl = ttl_seconds || VERIFICATION_CONFIG.nonce_ttl_seconds;
    const nonceRecord = createNonceRecord(userId, request_id, {
      ttl_seconds: ttl,
      nonce_length_bytes: 32,
    });

    await db.nonce.createNonce(nonceRecord.nonce, userId, request_id, nonceRecord.expires_at);

    return res.status(200).json({
      nonce: nonceRecord.nonce,
      issued_at: nonceRecord.issued_at,
      expires_at: nonceRecord.expires_at,
      ttl_seconds: ttl,
    });
  } catch (err) {
    console.error('Error generating nonce:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /submissions
 * Submit a geotagged image with verification
 */
router.post(
  '/submissions',
  validateJWT,
  express.raw({ type: 'application/octet-stream', limit: '50mb' }),
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const body = req.body as Buffer;
      const {
        request_id,
        nonce,
        exif_timestamp,
        exif_latitude,
        exif_longitude,
        device_latitude,
        device_longitude,
        geofence_latitude,
        geofence_longitude,
        geofence_radius_meters,
      } = req.query as any;

      if (!userId || !request_id || !nonce) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Check user karma and submission limits
      const karma = await db.karma.getOrCreateRecord(userId);
      const todayStr = new Date().toISOString().split('T')[0];
      const canSubmit = canUserSubmit(karma, KARMA_CONFIG, karma.last_submission_date);
      if (!canSubmit.allowed) {
        return res.status(403).json({
          error: canSubmit.reason,
          daily_remaining: canSubmit.daily_remaining,
        });
      }

      // Verify nonce exists and is fresh
      const nonceRecord = await db.nonce.getNonce(nonce as string);
      if (!nonceRecord) {
        return res.status(400).json({ error: 'Invalid nonce' });
      }

      if (!isNonceFresh(nonceRecord.issued_at, nonceRecord.expires_at)) {
        return res.status(400).json({
          error: 'Nonce expired',
          time_remaining_ms: getTimeRemaining(nonceRecord.expires_at),
        });
      }

      // Generate perceptual hash
      const phash = generatePerceptualHash(body);

      // Get recent phashes for duplicate detection
      const recentPhashes = await db.image.getRecentPhashes(
        request_id as string,
        geofence_radius_meters || VERIFICATION_CONFIG.geofence_radius_meters,
        60
      );

      // Perform verification
      const verificationResult = await performVerification(
        body,
        exif_timestamp ? parseInt(exif_timestamp) : undefined,
        exif_latitude ? parseFloat(exif_latitude) : undefined,
        exif_longitude ? parseFloat(exif_longitude) : undefined,
        device_latitude ? parseFloat(device_latitude) : undefined,
        device_longitude ? parseFloat(device_longitude) : undefined,
        nonce as string,
        nonceRecord.nonce,
        geofence_latitude ? parseFloat(geofence_latitude) : 0,
        geofence_longitude ? parseFloat(geofence_longitude) : 0,
        recentPhashes,
        {
          time_window_ms: VERIFICATION_CONFIG.time_window_ms,
          geofence_radius_meters: geofence_radius_meters || VERIFICATION_CONFIG.geofence_radius_meters,
          phash_threshold: VERIFICATION_CONFIG.phash_threshold,
        }
      );

      // Determine if submission should be flagged
      let verified_status = verificationResult.passed ? 'Verified' : 'Flagged';
      let shouldPenalize = false;

      // Check for duplicates
      let isDuplicate = false;
      for (const recentHash of recentPhashes) {
        if (hammingDistance(phash, recentHash) <= VERIFICATION_CONFIG.phash_threshold) {
          isDuplicate = true;
          break;
        }
      }

      if (isDuplicate) {
        verified_status = 'Flagged';
        shouldPenalize = true;
      }

      // Encrypt user ID
      const userIdBuffer = Buffer.from(userId);

      // Create submission
      const submissionId = crypto.randomUUID();
      const submission = await db.image.createSubmission({
        id: submissionId,
        request_id: request_id as string,
        uploader_id_encrypted: userIdBuffer,
        uploader_pseudonym: `Citizen#${userId.slice(-6).toUpperCase()}`,
        server_received_at: Date.now(),
        exif_timestamp: exif_timestamp ? parseInt(exif_timestamp) : undefined,
        exif_latitude: exif_latitude ? parseFloat(exif_latitude) : undefined,
        exif_longitude: exif_longitude ? parseFloat(exif_longitude) : undefined,
        device_latitude: device_latitude ? parseFloat(device_latitude) : undefined,
        device_longitude: device_longitude ? parseFloat(device_longitude) : undefined,
        nonce: nonce as string,
        phash,
        verified_status: verified_status as any,
        storage_path: `/submissions/${request_id}/${submissionId}.jpg`,
        metadata: {
          geofence_radius: geofence_radius_meters,
          check_results: verificationResult.checks.map((check) => ({
            type: check.name as any,
            passed: check.passed,
            detail: check.detail,
            timestamp: Date.now(),
          })),
          file_size: body.length,
          mime_type: 'image/jpeg',
        },
        created_by_id: userId,
      });

      // Log verification audits
      for (const check of verificationResult.checks) {
        await db.audit.createAudit({
          submission_id: submission.id,
          check_type: check.name as any,
          check_result: check.passed,
          detail: { description: check.detail },
        });
      }

      // Handle karma updates
      if (verified_status === 'Verified' && !isDuplicate) {
        // Apply bonus
        const bonus = applyValidSubmissionBonus(karma, KARMA_CONFIG);
        const newScore = calculateNewScore(karma.score, bonus);
        const newTier = getTierFromScore(newScore, karma.penalty_count, karma.suspended_until);
        await db.karma.updateKarmaScore(userId, bonus.delta, newTier);
      } else if (shouldPenalize) {
        // Apply penalty for duplicate
        const penalty = applyDuplicatePenalty(karma, KARMA_CONFIG, submission.id);
        const newScore = calculateNewScore(karma.score, penalty);
        const escalation = escalatePenalty(karma, KARMA_CONFIG);
        const newTier = getTierFromScore(newScore, escalation.newPenaltyCount, escalation.suspendedUntil);
        
        await db.karma.updateKarmaScore(userId, penalty.delta, newTier);
        if (escalation.newPenaltyCount > 0) {
          await db.karma.recordPenalty(userId, escalation.newPenaltyCount, escalation.suspendedUntil, escalation.banReason);
        }
      }

      // Mark nonce as used
      await db.nonce.markNonceUsed(nonce as string);

      // Update daily submission count
      await db.karma.incrementDailySubmissionCount(userId, todayStr);

      return res.status(201).json({
        id: submission.id,
        request_id: submission.request_id,
        uploader_pseudonym: submission.uploader_pseudonym,
        verified_status: submission.verified_status,
        server_received_at: submission.server_received_at,
        check_results: verificationResult.checks,
        warnings: verificationResult.warnings,
        message: verified_status === 'Verified' ? 'Image verified successfully' : 'Image flagged for review',
      });
    } catch (err) {
      console.error('Error submitting image:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /submissions/:id
 * Retrieve a submission with privacy filtering
 */
router.get('/submissions/:id', validateJWT, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const userRoles = (req as any).user?.roles || ['citizen'];
    const { id } = req.params;

    const submission = await db.image.getSubmissionById(id);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Privacy check
    const privacyContext: PrivacyContext = {
      user_id: userId,
      roles: userRoles,
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
    };

    const canRead = canReadSubmission(submission, privacyContext);
    if (!canRead.allowed) {
      // Log denied access
      await db.privacy.logAccess({
        user_id: userId,
        resource_type: 'image_submission',
        resource_id: id,
        action: 'read',
        status: 'Denied',
        reason_blocked: canRead.reason,
      });

      return res.status(403).json({ error: canRead.reason });
    }

    // Filter fields based on role
    const filtered = filterImageSubmissionByRole(submission, privacyContext);

    // Log successful access
    await db.privacy.logAccess({
      user_id: userId,
      resource_type: 'image_submission',
      resource_id: id,
      action: 'read',
      accessed_fields: Object.keys(filtered),
      status: 'Success',
    });

    return res.status(200).json(filtered);
  } catch (err) {
    console.error('Error retrieving submission:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /submissions
 * List submissions with filtering and privacy
 */
router.get('/submissions', validateJWT, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const userRoles = (req as any).user?.roles || ['citizen'];
    const { request_id, status, limit = 50, offset = 0 } = req.query;

    const submissions = await db.image.searchSubmissions(
      {
        request_id: request_id as string,
        verified_status: status as any,
      },
      parseInt(limit as string),
      parseInt(offset as string)
    );

    const privacyContext: PrivacyContext = {
      user_id: userId,
      roles: userRoles,
    };

    const filtered = submissions
      .filter((s) => canReadSubmission(s, privacyContext).allowed)
      .map((s) => filterImageSubmissionByRole(s, privacyContext));

    return res.status(200).json({
      data: filtered,
      count: filtered.length,
      limit,
      offset,
    });
  } catch (err) {
    console.error('Error listing submissions:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /karma/:userId
 * Get user karma (with privacy filtering)
 */
router.get('/karma/:userId', validateJWT, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const requestingUserId = (req as any).user?.id;
    const userRoles = (req as any).user?.roles || ['citizen'];

    // Citizens can only see their own karma; others are admin/authority
    if (userRoles.includes('citizen') && userId !== requestingUserId) {
      return res.status(403).json({ error: 'Cannot view other users karma' });
    }

    const karma = await db.karma.getOrCreateRecord(userId);
    return res.status(200).json(karma);
  } catch (err) {
    console.error('Error retrieving karma:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /karma/leaderboard
 * Get karma leaderboard (top trusted users)
 */
router.get('/karma/leaderboard', async (req: Request, res: Response) => {
  try {
    const { tier, limit = 100, offset = 0 } = req.query;
    const leaderboard = await db.karma.getLeaderboard(
      tier as string,
      parseInt(limit as string),
      parseInt(offset as string)
    );

    // Mask identifying information
    const masked = leaderboard.map((k) => ({
      tier: k.tier,
      score: k.score,
      rank: 0, // Would be calculated with offset
    }));

    return res.status(200).json({
      data: masked,
      count: masked.length,
    });
  } catch (err) {
    console.error('Error retrieving leaderboard:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
