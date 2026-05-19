import type { KarmaRecord, KarmaTier } from './image-types';

/**
 * Karma System Service
 * Manages user reputation scoring, tier assignment, and fraud penalties
 */

export interface KarmaConfig {
  initial_score: number; // default 100
  valid_submission_bonus: number; // +10
  flagged_penalty: number; // -50
  duplicate_penalty: number; // -30
  rejected_penalty: number; // -75
  appeal_success_restore: number; // +30
  daily_submission_limit: number; // 10
  suspension_threshold_score: number; // < -100
  ban_threshold_penalty_count: number; // 3+ penalties
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
export function getTierFromScore(
  score: number,
  penaltyCount: number,
  suspendedUntil: number
): KarmaTier {
  const now = Date.now();

  // Check if currently suspended
  if (suspendedUntil > now) {
    return 'Suspended';
  }

  // Check if banned
  if (penaltyCount >= 3) {
    return 'Banned';
  }

  // Score-based tiers
  if (score >= 500) {
    return 'Trusted';
  } else if (score >= 100) {
    return 'Standard';
  } else if (score >= 0) {
    return 'AtRisk';
  } else {
    return 'Suspended'; // auto-suspend if negative score
  }
}

/**
 * Apply karma bonus for valid submission
 */
export function applyValidSubmissionBonus(
  current: KarmaRecord,
  config: KarmaConfig
): KarmaTransaction {
  return {
    user_id: current.user_id,
    delta: config.valid_submission_bonus,
    reason: 'valid_submission_bonus',
    timestamp: Date.now(),
  };
}

/**
 * Apply penalty for flagged/rejected submission
 */
export function applyFlaggedPenalty(
  current: KarmaRecord,
  config: KarmaConfig,
  submission_id: string
): KarmaTransaction {
  const delta = config.flagged_penalty;
  return {
    user_id: current.user_id,
    delta,
    reason: 'flagged_submission_penalty',
    submission_id,
    timestamp: Date.now(),
  };
}

/**
 * Apply penalty for duplicate image
 */
export function applyDuplicatePenalty(
  current: KarmaRecord,
  config: KarmaConfig,
  submission_id: string
): KarmaTransaction {
  return {
    user_id: current.user_id,
    delta: config.duplicate_penalty,
    reason: 'duplicate_image_penalty',
    submission_id,
    timestamp: Date.now(),
  };
}

/**
 * Apply penalty for rejected submission (most severe)
 */
export function applyRejectedPenalty(
  current: KarmaRecord,
  config: KarmaConfig,
  submission_id: string
): KarmaTransaction {
  return {
    user_id: current.user_id,
    delta: config.rejected_penalty,
    reason: 'rejected_submission_penalty',
    submission_id,
    timestamp: Date.now(),
  };
}

/**
 * Escalate penalties and apply suspension/ban
 */
export function escalatePenalty(
  current: KarmaRecord,
  config: KarmaConfig
): {
  newPenaltyCount: number;
  suspendedUntil: number;
  shouldBan: boolean;
  banReason?: string;
} {
  const newPenaltyCount = current.penalty_count + 1;
  let suspendedUntil = 0;
  let shouldBan = false;
  let banReason: string | undefined;

  if (newPenaltyCount === 1) {
    // 1st offense: warn, no suspension
    suspendedUntil = 0;
  } else if (newPenaltyCount === 2) {
    // 2nd offense: suspend for 7 days
    suspendedUntil = Date.now() + 7 * 24 * 60 * 60 * 1000;
  } else if (newPenaltyCount >= 3) {
    // 3rd+ offense: permanent ban
    shouldBan = true;
    banReason = `Permanent ban after ${newPenaltyCount} verified fraud incidents`;
  }

  return {
    newPenaltyCount,
    suspendedUntil,
    shouldBan,
    banReason,
  };
}

/**
 * Check if user can submit (rate limiting + karma checks)
 */
export function canUserSubmit(
  karma: KarmaRecord,
  config: KarmaConfig,
  lastSubmissionDate: string | undefined
): {
  allowed: boolean;
  reason?: string;
  daily_remaining?: number;
} {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // Check if banned
  if (karma.tier === 'Banned') {
    return { allowed: false, reason: 'User is permanently banned' };
  }

  // Check if suspended
  if (karma.suspended_until > Date.now()) {
    const until = new Date(karma.suspended_until);
    return {
      allowed: false,
      reason: `User is suspended until ${until.toISOString()}`,
    };
  }

  // Check daily submission limit
  if (lastSubmissionDate === todayStr) {
    const remaining = Math.max(0, config.daily_submission_limit - karma.daily_submission_count);
    if (remaining <= 0) {
      return {
        allowed: false,
        reason: `Daily submission limit (${config.daily_submission_limit}) reached`,
      };
    }
    return { allowed: true, daily_remaining: remaining };
  }

  // New day, reset counter
  return { allowed: true, daily_remaining: config.daily_submission_limit };
}

/**
 * Process karma appeal (citizen can appeal a penalty)
 */
export function processAppealOutcome(
  current: KarmaRecord,
  approved: boolean,
  config: KarmaConfig
): KarmaTransaction | null {
  if (!approved) {
    // Appeal rejected: no change
    return null;
  }

  // Appeal approved: restore some karma
  return {
    user_id: current.user_id,
    delta: config.appeal_success_restore,
    reason: 'appeal_approved_restoration',
    timestamp: Date.now(),
  };
}

/**
 * Calculate adjusted score after transaction
 */
export function calculateNewScore(
  currentScore: number,
  transaction: KarmaTransaction,
  minScore: number = -500,
  maxScore: number = 10000
): number {
  const newScore = currentScore + transaction.delta;
  return Math.max(minScore, Math.min(maxScore, newScore));
}

/**
 * Generate karma leaderboard (top trusted users)
 */
export function generateLeaderboardQuery(
  tier?: KarmaTier,
  limit: number = 100,
  offset: number = 0
): {
  where: Record<string, unknown>;
  order: [string, string];
  limit: number;
  offset: number;
} {
  const where: Record<string, unknown> = {};

  if (tier) {
    where.tier = tier;
  }

  return {
    where,
    order: ['score', 'DESC'],
    limit,
    offset,
  };
}

/**
 * Suggest tier-based submission review priority
 */
export function getReviewPriority(tier: KarmaTier): 'low' | 'medium' | 'high' {
  switch (tier) {
    case 'Banned':
    case 'Suspended':
      return 'high'; // auto-flag all submissions
    case 'AtRisk':
      return 'high'; // manual review required
    case 'Standard':
      return 'medium'; // spot-check sampling
    case 'Trusted':
      return 'low'; // light verification
  }
}

/**
 * Decay karma over time (optional: reduce bias from old incidents)
 * Example: reduce penalty impact after 6 months of good behavior
 */
export function applyKarmaDecay(
  current: KarmaRecord,
  decayRate: number = 0.02, // 2% per month
  monthsElapsed: number = 1
): number {
  if (current.score < 0) {
    // Gradually recover from negative scores
    const decay = Math.pow(1 - decayRate, monthsElapsed);
    const newScore = current.score * decay;
    return Math.max(0, newScore);
  }
  return current.score;
}
