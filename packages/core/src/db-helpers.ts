import { types } from 'cassandra-driver';
import { Pool } from './cassandra-adapter';
import type {
    AccessLog,
    ImageSubmission,
    KarmaRecord,
    ServerNonce,
    UserPrivacyProfile,
    VerificationAudit,
    VerificationStatus,
} from './image-types';

/**
 * Database helpers for image submission, karma, and audit operations
 */

export class ImageSubmissionDB {
  constructor(private pool: Pool) {}

  async createSubmission(submission: Partial<ImageSubmission>): Promise<ImageSubmission> {
    const query = `
      INSERT INTO image_submissions (
        request_id, uploader_id_encrypted, uploader_pseudonym, server_received_at,
        exif_timestamp, exif_latitude, exif_longitude, device_latitude, device_longitude,
        nonce, phash, verified_status, storage_path, metadata, created_by_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
    `;

    // Cassandra: do an INSERT then read back by request_id (assumes request_id is unique)
    await (this.pool.client as any).execute(query.replace(/\$\d+/g, '?'), [
      submission.request_id,
      submission.uploader_id_encrypted,
      submission.uploader_pseudonym,
      submission.server_received_at ?? Date.now(),
      submission.exif_timestamp ?? null,
      submission.exif_latitude ?? null,
      submission.exif_longitude ?? null,
      submission.device_latitude ?? null,
      submission.device_longitude ?? null,
      submission.nonce ?? null,
      submission.phash ?? null,
      submission.verified_status || 'Pending',
      submission.storage_path ?? null,
      JSON.stringify(submission.metadata || {}),
      submission.created_by_id ?? null,
    ], { prepare: true });

    const sel = await (this.pool.client as any).execute('SELECT * FROM image_submissions WHERE request_id = ? LIMIT 1', [submission.request_id], { prepare: true });
    return sel.rows[0];
  }

  async getSubmissionById(id: string): Promise<ImageSubmission | null> {
    const res = await (this.pool.client as any).execute('SELECT * FROM image_submissions WHERE id = ? LIMIT 1', [id], { prepare: true });
    return res.rows[0] || null;
  }

  async getSubmissionsByRequest(requestId: string): Promise<ImageSubmission[]> {
    const res = await (this.pool.client as any).execute('SELECT * FROM image_submissions WHERE request_id = ? ALLOW FILTERING', [requestId], { prepare: true });
    const rows = res.rows as ImageSubmission[];
    rows.sort((a, b) => (b.server_received_at || 0) - (a.server_received_at || 0));
    return rows;
  }

  async getSubmissionsByUser(userId: string, limit: number = 50, offset: number = 0): Promise<ImageSubmission[]> {
    const res = await (this.pool.client as any).execute('SELECT * FROM image_submissions WHERE created_by_id = ? ALLOW FILTERING', [userId], { prepare: true });
    let rows = res.rows as ImageSubmission[];
    rows.sort((a, b) => (b.server_received_at || 0) - (a.server_received_at || 0));
    return rows.slice(offset, offset + limit);
  }

  async getRecentPhashes(
    requestId: string,
    radiusMeters: number,
    lookbackMinutes: number = 60
  ): Promise<string[]> {
    // Get recent phashes for duplicate detection
    const query = `
      SELECT DISTINCT phash FROM image_submissions
      WHERE request_id = $1 
      AND server_received_at > $2
      AND phash IS NOT NULL
      LIMIT 50
    `;
    const cutoffTime = Date.now() - lookbackMinutes * 60 * 1000;
    const res = await (this.pool.client as any).execute('SELECT phash FROM image_submissions WHERE request_id = ? AND server_received_at > ? ALLOW FILTERING LIMIT 50', [requestId, cutoffTime], { prepare: true });
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of res.rows) {
      const p = r.phash as string | null;
      if (p && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out;
  }

  async updateVerificationStatus(
    id: string,
    status: VerificationStatus,
    metadata?: any
  ): Promise<ImageSubmission | null> {
    const query = `UPDATE image_submissions SET verified_status = ?, metadata = ? WHERE id = ?`;
    await (this.pool.client as any).execute(query, [status, metadata ? JSON.stringify(metadata) : null, id], { prepare: true });
    const res = await (this.pool.client as any).execute('SELECT * FROM image_submissions WHERE id = ? LIMIT 1', [id], { prepare: true });
    return res.rows[0] || null;
  }

  async searchSubmissions(
    filters: {
      verified_status?: VerificationStatus;
      uploader_pseudonym?: string;
      request_id?: string;
      created_after?: number;
      created_before?: number;
    },
    limit: number = 50,
    offset: number = 0
  ): Promise<ImageSubmission[]> {
    // Cassandra does not support flexible WHERE + OFFSET in the same way.
    // Implement a simple scan with allowed filters and do ordering + paging in JS.
    const cql = 'SELECT * FROM image_submissions';
    const res = await (this.pool.client as any).execute(cql, [], { prepare: true });
    let rows = res.rows as ImageSubmission[];
    if (filters.verified_status) rows = rows.filter(r => r.verified_status === filters.verified_status);
    if (filters.uploader_pseudonym) rows = rows.filter(r => (r.uploader_pseudonym || '').toLowerCase().includes(filters.uploader_pseudonym!.toLowerCase()));
    if (filters.request_id) rows = rows.filter(r => r.request_id === filters.request_id);
    if (filters.created_after) rows = rows.filter(r => r.server_received_at && r.server_received_at >= filters.created_after!);
    if (filters.created_before) rows = rows.filter(r => r.server_received_at && r.server_received_at <= filters.created_before!);
    rows = rows.sort((a, b) => (b.server_received_at || 0) - (a.server_received_at || 0));
    return rows.slice(offset, offset + limit);
  }
}

export class KarmaDB {
  constructor(private pool: Pool) {}
  async getOrCreateRecord(userId: string, initialScore: number = 100): Promise<KarmaRecord> {
    const sel = await (this.pool.client as any).execute('SELECT * FROM karma_records WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
    if (sel.rowLength > 0) return sel.rows[0];
    const now = Date.now();
    await (this.pool.client as any).execute('INSERT INTO karma_records (user_id, score, tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [userId, initialScore, 'Standard', now, now], { prepare: true });
    const res = await (this.pool.client as any).execute('SELECT * FROM karma_records WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
    return res.rows[0];
  }

  async updateKarmaScore(
    userId: string,
    delta: number,
    tier?: string
  ): Promise<KarmaRecord | null> {
    const sel = await (this.pool.client as any).execute('SELECT score, tier FROM karma_records WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
    if (sel.rowLength === 0) return null;
    const cur = sel.rows[0];
    const newScore = (cur.score || 0) + delta;
    const newTier = tier ?? cur.tier;
    const now = Date.now();
    await (this.pool.client as any).execute('UPDATE karma_records SET score = ?, tier = ?, updated_at = ? WHERE user_id = ?', [newScore, newTier, now, userId], { prepare: true });
    const res = await (this.pool.client as any).execute('SELECT * FROM karma_records WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
    return res.rows[0] || null;
  }

  async recordPenalty(
    userId: string,
    penaltyCount: number,
    suspendedUntil: number,
    banReason?: string
  ): Promise<KarmaRecord | null> {
    const now = Date.now();
    await (this.pool.client as any).execute('UPDATE karma_records SET penalty_count = ?, last_penalty_at = ?, suspended_until = ?, ban_reason = ?, updated_at = ? WHERE user_id = ?', [penaltyCount, now, suspendedUntil, banReason ?? null, now, userId], { prepare: true });
    const res = await (this.pool.client as any).execute('SELECT * FROM karma_records WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
    return res.rows[0] || null;
  }

  async incrementDailySubmissionCount(userId: string, today: string): Promise<KarmaRecord | null> {
    const sel = await (this.pool.client as any).execute('SELECT daily_submission_count, last_submission_date FROM karma_records WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
    let count = 1;
    if (sel.rowLength > 0) {
      const cur = sel.rows[0];
      if (String(cur.last_submission_date) === String(today)) {
        count = (cur.daily_submission_count || 0) + 1;
      }
    }
    const now = Date.now();
    await (this.pool.client as any).execute('UPDATE karma_records SET daily_submission_count = ?, last_submission_date = ?, updated_at = ? WHERE user_id = ?', [count, today, now, userId], { prepare: true });
    const res = await (this.pool.client as any).execute('SELECT * FROM karma_records WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
    return res.rows[0] || null;
  }

  async getLeaderboard(tier?: string, limit: number = 100, offset: number = 0): Promise<KarmaRecord[]> {
    const res = await (this.pool.client as any).execute('SELECT user_id, score, tier, created_at, updated_at FROM karma_records', [], { prepare: true });
    let rows = res.rows as KarmaRecord[];
    if (tier) rows = rows.filter(r => r.tier === tier);
    rows = rows.sort((a, b) => (b.score || 0) - (a.score || 0));
    return rows.slice(offset, offset + limit);
  }
}

export class VerificationAuditDB {
  constructor(private pool: Pool) {}
  async createAudit(audit: Partial<VerificationAudit>): Promise<VerificationAudit> {
    const id = types.TimeUuid.now();
    const createdAt = Date.now();
    await (this.pool.client as any).execute('INSERT INTO verification_audits (id, submission_id, check_type, check_result, detail, reviewer_id, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, audit.submission_id, audit.check_type, audit.check_result, JSON.stringify(audit.detail || {}), audit.reviewer_id ?? null, audit.action ?? null, audit.reason ?? null, createdAt], { prepare: true });
    const res = await (this.pool.client as any).execute('SELECT * FROM verification_audits WHERE id = ? LIMIT 1', [id], { prepare: true });
    return res.rows[0];
  }

  async getAuditsBySubmission(submissionId: string): Promise<VerificationAudit[]> {
    const res = await (this.pool.client as any).execute('SELECT * FROM verification_audits WHERE submission_id = ? ALLOW FILTERING', [submissionId], { prepare: true });
    const rows = res.rows as VerificationAudit[];
    rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return rows;
  }

  async getFailedChecks(submissionId: string): Promise<VerificationAudit[]> {
    const res = await (this.pool.client as any).execute('SELECT * FROM verification_audits WHERE submission_id = ? AND check_result = ? ALLOW FILTERING', [submissionId, false], { prepare: true });
    const rows = res.rows as VerificationAudit[];
    rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return rows;
  }
}

export class NonceDB {
  constructor(private pool: Pool) {}

  async createNonce(
    nonce: string,
    userId: string,
    requestId: string,
    expiresAt: number
  ): Promise<ServerNonce> {
    const now = Date.now();
    await (this.pool.client as any).execute('INSERT INTO server_nonces (nonce, user_id, request_id, issued_at, expires_at, used) VALUES (?, ?, ?, ?, ?, ?)', [nonce, userId, requestId, now, expiresAt, false], { prepare: true });
    const res = await (this.pool.client as any).execute('SELECT * FROM server_nonces WHERE nonce = ? LIMIT 1', [nonce], { prepare: true });
    return res.rows[0];
  }

  async getNonce(nonce: string): Promise<ServerNonce | null> {
    const res = await (this.pool.client as any).execute('SELECT * FROM server_nonces WHERE nonce = ? LIMIT 1', [nonce], { prepare: true });
    return res.rows[0] || null;
  }

  async markNonceUsed(nonce: string): Promise<ServerNonce | null> {
    const now = Date.now();
    await (this.pool.client as any).execute('UPDATE server_nonces SET used = ?, used_at = ? WHERE nonce = ?', [true, now, nonce], { prepare: true });
    const res = await (this.pool.client as any).execute('SELECT * FROM server_nonces WHERE nonce = ? LIMIT 1', [nonce], { prepare: true });
    return res.rows[0] || null;
  }

  async cleanupExpiredNonces(): Promise<number> {
    const cutoff = Date.now();
    const sel = await (this.pool.client as any).execute('SELECT nonce FROM server_nonces WHERE expires_at < ? ALLOW FILTERING', [cutoff], { prepare: true });
    if (sel.rowLength === 0) return 0;
    await Promise.all(sel.rows.map((r: any) => (this.pool.client as any).execute('DELETE FROM server_nonces WHERE nonce = ?', [r.nonce], { prepare: true })));
    return sel.rowLength;
  }
}

export class PrivacyDB {
  constructor(private pool: Pool) {}

  async getOrCreateProfile(userId: string): Promise<UserPrivacyProfile> {
    const sel = await (this.pool.client as any).execute('SELECT * FROM user_privacy_profiles WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
    const now = Date.now();
    if (sel.rowLength > 0) {
      await (this.pool.client as any).execute('UPDATE user_privacy_profiles SET updated_at = ? WHERE user_id = ?', [now, userId], { prepare: true });
      const r2 = await (this.pool.client as any).execute('SELECT * FROM user_privacy_profiles WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
      return r2.rows[0];
    }
    await (this.pool.client as any).execute('INSERT INTO user_privacy_profiles (user_id, created_at, updated_at) VALUES (?, ?, ?)', [userId, now, now], { prepare: true });
    const r3 = await (this.pool.client as any).execute('SELECT * FROM user_privacy_profiles WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
    return r3.rows[0];
  }

  async logAccess(log: Partial<AccessLog>): Promise<AccessLog> {
    const id = types.TimeUuid.now();
    const createdAt = Date.now();
    await (this.pool.client as any).execute('INSERT INTO access_logs (id, user_id, resource_type, resource_id, action, accessed_fields, ip_address, user_agent, status, reason_blocked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, log.user_id, log.resource_type, log.resource_id, log.action, JSON.stringify(log.accessed_fields || []), log.ip_address ?? null, log.user_agent ?? null, log.status ?? null, log.reason_blocked ?? null, createdAt], { prepare: true });
    const res = await (this.pool.client as any).execute('SELECT * FROM access_logs WHERE id = ? LIMIT 1', [id], { prepare: true });
    return res.rows[0];
  }

  async getAccessLog(userId: string, limit: number = 100, offset: number = 0): Promise<AccessLog[]> {
    const res = await (this.pool.client as any).execute('SELECT * FROM access_logs WHERE user_id = ? LIMIT ?', [userId, limit], { prepare: true });
    const rows = res.rows as AccessLog[];
    rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return rows.slice(offset, offset + limit);
  }
}
