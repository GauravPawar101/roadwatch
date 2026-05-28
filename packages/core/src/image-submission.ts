export { ImageSubmissionDB, KarmaDB, VerificationAuditDB, NonceDB, PrivacyDB } from './db-helpers';

export class KarmaDB {
  constructor(private pool: Pool) {}

  async getOrCreateRecord(userId: string, initialScore: number = 100): Promise<KarmaRecord> {
    const res = await this.pool.query<KarmaRecord>(
      `INSERT INTO karma_records (user_id, score, tier, created_at, updated_at)
       VALUES ($1, $2, 'Standard', NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET updated_at = karma_records.updated_at
       RETURNING *`,
      [userId, initialScore]
    );
    return res.rows[0]!;
  }

  async updateKarmaScore(
    userId: string,
    delta: number,
    tier?: string
  ): Promise<KarmaRecord | null> {
    const res = await this.pool.query<KarmaRecord>(
      `UPDATE karma_records
       SET score      = score + $1,
           tier       = COALESCE($2, tier),
           updated_at = NOW()
       WHERE user_id = $3
       RETURNING *`,
      [delta, tier ?? null, userId]
    );
    return res.rows[0] ?? null;
  }

  async recordPenalty(
    userId: string,
    penaltyCount: number,
    suspendedUntil: number,
    banReason?: string
  ): Promise<KarmaRecord | null> {
    const res = await this.pool.query<KarmaRecord>(
      `UPDATE karma_records
       SET penalty_count   = $1,
           last_penalty_at = NOW(),
           suspended_until = $2,
           ban_reason      = $3,
           updated_at      = NOW()
       WHERE user_id = $4
       RETURNING *`,
      [penaltyCount, new Date(suspendedUntil), banReason ?? null, userId]
    );
    return res.rows[0] ?? null;
  }

  async incrementDailySubmissionCount(
    userId: string,
    today: string
  ): Promise<KarmaRecord | null> {
    // Reset count to 1 when the date rolls over; otherwise increment.
    const res = await this.pool.query<KarmaRecord>(
      `UPDATE karma_records
       SET daily_submission_count = CASE
             WHEN last_submission_date = $1 THEN daily_submission_count + 1
             ELSE 1
           END,
           last_submission_date = $1,
           updated_at           = NOW()
       WHERE user_id = $2
       RETURNING *`,
      [today, userId]
    );
    return res.rows[0] ?? null;
  }

  async getLeaderboard(
    tier?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<KarmaRecord[]> {
    const res = await this.pool.query<KarmaRecord>(
      `SELECT user_id, score, tier, created_at, updated_at
       FROM karma_records
       ${tier ? 'WHERE tier = $1' : ''}
       ORDER BY score DESC
       LIMIT $${tier ? 2 : 1} OFFSET $${tier ? 3 : 2}`,
      tier ? [tier, limit, offset] : [limit, offset]
    );
    return res.rows;
  }
}

export class VerificationAuditDB {
  constructor(private pool: Pool) {}

  async createAudit(audit: Partial<VerificationAudit>): Promise<VerificationAudit> {
    const res = await this.pool.query<VerificationAudit>(
      `INSERT INTO verification_audits
         (id, submission_id, check_type, check_result, detail, reviewer_id, action, reason, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [
        audit.submission_id,
        audit.check_type,
        audit.check_result,
        audit.detail ?? {},
        audit.reviewer_id ?? null,
        audit.action ?? null,
        audit.reason ?? null,
      ]
    );
    return res.rows[0]!;
  }

  async getAuditsBySubmission(submissionId: string): Promise<VerificationAudit[]> {
    const res = await this.pool.query<VerificationAudit>(
      `SELECT * FROM verification_audits
       WHERE submission_id = $1
       ORDER BY created_at DESC`,
      [submissionId]
    );
    return res.rows;
  }

  async getFailedChecks(submissionId: string): Promise<VerificationAudit[]> {
    const res = await this.pool.query<VerificationAudit>(
      `SELECT * FROM verification_audits
       WHERE submission_id = $1
         AND check_result  = false
       ORDER BY created_at DESC`,
      [submissionId]
    );
    return res.rows;
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
    const res = await this.pool.query<ServerNonce>(
      `INSERT INTO server_nonces (nonce, user_id, request_id, issued_at, expires_at, used)
       VALUES ($1, $2, $3, NOW(), $4, false)
       RETURNING *`,
      [nonce, userId, requestId, new Date(expiresAt)]
    );
    return res.rows[0]!;
  }

  async getNonce(nonce: string): Promise<ServerNonce | null> {
    const res = await this.pool.query<ServerNonce>(
      `SELECT * FROM server_nonces WHERE nonce = $1 LIMIT 1`,
      [nonce]
    );
    return res.rows[0] ?? null;
  }

  async markNonceUsed(nonce: string): Promise<ServerNonce | null> {
    const res = await this.pool.query<ServerNonce>(
      `UPDATE server_nonces
       SET used    = true,
           used_at = NOW()
       WHERE nonce = $1
       RETURNING *`,
      [nonce]
    );
    return res.rows[0] ?? null;
  }

  async cleanupExpiredNonces(): Promise<number> {
    const res = await this.pool.query(
      `DELETE FROM server_nonces WHERE expires_at < NOW()`
    );
    return res.rowCount ?? 0;
  }
}

export class PrivacyDB {
  constructor(private pool: Pool) {}

  async getOrCreateProfile(userId: string): Promise<UserPrivacyProfile> {
    const res = await this.pool.query<UserPrivacyProfile>(
      `INSERT INTO user_privacy_profiles (user_id, created_at, updated_at)
       VALUES ($1, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [userId]
    );
    return res.rows[0]!;
  }

  async logAccess(log: Partial<AccessLog>): Promise<AccessLog> {
    const res = await this.pool.query<AccessLog>(
      `INSERT INTO access_logs
         (id, user_id, resource_type, resource_id, action, accessed_fields,
          ip_address, user_agent, status, reason_blocked, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING *`,
      [
        log.user_id,
        log.resource_type,
        log.resource_id,
        log.action,
        log.accessed_fields ?? [],
        log.ip_address ?? null,
        log.user_agent ?? null,
        log.status ?? null,
        log.reason_blocked ?? null,
      ]
    );
    return res.rows[0]!;
  }

  async getAccessLog(
    userId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<AccessLog[]> {
    const res = await this.pool.query<AccessLog>(
      `SELECT * FROM access_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return res.rows;
  }
}
