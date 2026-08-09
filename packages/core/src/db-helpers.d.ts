import type { Pool } from 'pg';
import type { AccessLog, ImageSubmission, KarmaRecord, ServerNonce, UserPrivacyProfile, VerificationAudit, VerificationStatus } from './image-types';
/**
 * Database helpers for image submission, karma, nonce, audit and privacy operations
 */
export declare class ImageSubmissionDB {
    private pool;
    constructor(pool: Pool);
    createSubmission(submission: Partial<ImageSubmission>): Promise<ImageSubmission>;
    createSubmissionTransactional(submission: Partial<ImageSubmission>): Promise<ImageSubmission>;
    getSubmission(requestId: string): Promise<ImageSubmission | null>;
    getSubmissionById(id: string): Promise<ImageSubmission | null>;
    getSubmissionsByRequest(requestId: string): Promise<ImageSubmission[]>;
    getSubmissionsByUser(userId: string, limit?: number, offset?: number): Promise<ImageSubmission[]>;
    getRecentPhashes(requestId: string, _radiusMeters: number, lookbackMinutes?: number): Promise<string[]>;
    updateVerificationStatus(id: string, status: VerificationStatus, metadata?: any): Promise<ImageSubmission | null>;
    updateVerificationStatusByRequest(requestId: string, status: VerificationStatus, metadataPatch?: Record<string, any>): Promise<ImageSubmission>;
    searchSubmissions(filters: {
        verified_status?: VerificationStatus;
        uploader_pseudonym?: string;
        request_id?: string;
        created_after?: number;
        created_before?: number;
    }, limit?: number, offset?: number): Promise<ImageSubmission[]>;
}
export declare class KarmaDB {
    private pool;
    constructor(pool: Pool);
    getOrCreateRecord(userId: string, initialScore?: number): Promise<KarmaRecord>;
    updateKarmaScore(userId: string, delta: number, tier?: string): Promise<KarmaRecord | null>;
    recordPenalty(userId: string, penaltyCount: number, suspendedUntil: number, banReason?: string): Promise<KarmaRecord | null>;
    incrementDailySubmissionCount(userId: string, today: string): Promise<KarmaRecord | null>;
    getLeaderboard(tier?: string, limit?: number, offset?: number): Promise<KarmaRecord[]>;
    addKarma(karma: Partial<KarmaRecord> & {
        points?: number;
        action_type?: string;
        reference_id?: string;
    }): Promise<KarmaRecord>;
    getUserKarmaTotal(userId: string): Promise<number>;
}
export declare class VerificationAuditDB {
    private pool;
    constructor(pool: Pool);
    createAudit(audit: Partial<VerificationAudit>): Promise<VerificationAudit>;
    getAuditsBySubmission(submissionId: string): Promise<VerificationAudit[]>;
    getFailedChecks(submissionId: string): Promise<VerificationAudit[]>;
    createAuditLog(audit: Partial<VerificationAudit>): Promise<VerificationAudit>;
    getAuditsForSubmission(submissionId: string): Promise<VerificationAudit[]>;
}
export declare class NonceDB {
    private pool;
    constructor(pool: Pool);
    createNonce(nonce: string, userId: string, requestId: string, expiresAt: number): Promise<ServerNonce>;
    getNonce(nonce: string): Promise<ServerNonce | null>;
    markNonceUsed(nonce: string): Promise<ServerNonce | null>;
    cleanupExpiredNonces(): Promise<number>;
    saveNonce(nonceStr: string, ttlSeconds?: number): Promise<ServerNonce>;
    useNonce(nonceStr: string): Promise<boolean>;
}
export declare class PrivacyDB {
    private pool;
    constructor(pool: Pool);
    getOrCreateProfile(userId: string): Promise<UserPrivacyProfile>;
    getOrCreatePrivacyProfile(userId: string): Promise<UserPrivacyProfile>;
    logAccess(log: Partial<AccessLog>): Promise<AccessLog>;
    getAccessLog(userId: string, limit?: number, offset?: number): Promise<AccessLog[]>;
}
//# sourceMappingURL=db-helpers.d.ts.map