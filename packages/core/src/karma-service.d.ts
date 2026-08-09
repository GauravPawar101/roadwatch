import type { KarmaRecord, KarmaTier } from './image-types';
/**
 * Karma System Service
 * Manages user reputation scoring, tier assignment, and fraud penalties
 */
export interface KarmaConfig {
    initial_score: number;
    valid_submission_bonus: number;
    flagged_penalty: number;
    duplicate_penalty: number;
    rejected_penalty: number;
    appeal_success_restore: number;
    daily_submission_limit: number;
    suspension_threshold_score: number;
    ban_threshold_penalty_count: number;
}
export interface KarmaTransaction {
    user_id: string;
    delta: number;
    reason: string;
    submission_id?: string;
    timestamp: number;
}
/**
 * Determine karma tier based on score and penalty history
 */
export declare function getTierFromScore(score: number, penaltyCount: number, suspendedUntil: number): KarmaTier;
/**
 * Apply karma bonus for valid submission
 */
export declare function applyValidSubmissionBonus(current: KarmaRecord, config: KarmaConfig): KarmaTransaction;
/**
 * Apply penalty for flagged/rejected submission
 */
export declare function applyFlaggedPenalty(current: KarmaRecord, config: KarmaConfig, submission_id: string): KarmaTransaction;
/**
 * Apply penalty for duplicate image
 */
export declare function applyDuplicatePenalty(current: KarmaRecord, config: KarmaConfig, submission_id: string): KarmaTransaction;
/**
 * Apply penalty for rejected submission (most severe)
 */
export declare function applyRejectedPenalty(current: KarmaRecord, config: KarmaConfig, submission_id: string): KarmaTransaction;
/**
 * Escalate penalties and apply suspension/ban
 */
export declare function escalatePenalty(current: KarmaRecord, config: KarmaConfig): {
    newPenaltyCount: number;
    suspendedUntil: number;
    shouldBan: boolean;
    banReason?: string;
};
/**
 * Check if user can submit (rate limiting + karma checks)
 */
export declare function canUserSubmit(karma: KarmaRecord, config: KarmaConfig, lastSubmissionDate: string | undefined): {
    allowed: boolean;
    reason?: string;
    daily_remaining?: number;
};
/**
 * Process karma appeal (citizen can appeal a penalty)
 */
export declare function processAppealOutcome(current: KarmaRecord, approved: boolean, config: KarmaConfig): KarmaTransaction | null;
/**
 * Calculate adjusted score after transaction
 */
export declare function calculateNewScore(currentScore: number, transaction: KarmaTransaction, minScore?: number, maxScore?: number): number;
/**
 * Generate karma leaderboard (top trusted users)
 */
export declare function generateLeaderboardQuery(tier?: KarmaTier, limit?: number, offset?: number): {
    where: Record<string, unknown>;
    order: [string, string];
    limit: number;
    offset: number;
};
/**
 * Suggest tier-based submission review priority
 */
export declare function getReviewPriority(tier: KarmaTier): 'low' | 'medium' | 'high';
/**
 * Decay karma over time (optional: reduce bias from old incidents)
 * Example: reduce penalty impact after 6 months of good behavior
 */
export declare function applyKarmaDecay(current: KarmaRecord, decayRate?: number, // 2% per month
monthsElapsed?: number): number;
//# sourceMappingURL=karma-service.d.ts.map