import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useKarma } from '../hooks/useImageSubmissions';

type Props = {
  userId?: string;
  showDetails?: boolean;
  className?: string;
};

export default function KarmaDisplay({ userId, showDetails = false, className = '' }: Props) {
  const { user } = useAuth();
  const targetUserId = userId || user?.id;
  const { karma, loading, error } = useKarma(targetUserId);

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-6 bg-gray-200 rounded w-20"></div>
      </div>
    );
  }

  if (error || !karma) {
    return null;
  }

  const getTierColor = (tier: string) => {
    switch (tier.toLowerCase()) {
      case 'gold': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'silver': return 'text-gray-600 bg-gray-50 border-gray-200';
      case 'bronze': return 'text-orange-600 bg-orange-50 border-orange-200';
      default: return 'text-blue-600 bg-blue-50 border-blue-200';
    }
  };

  const getTierIcon = (tier: string) => {
    switch (tier.toLowerCase()) {
      case 'gold': return 'emoji_events';
      case 'silver': return 'military_tech';
      case 'bronze': return 'workspace_premium';
      default: return 'star';
    }
  };

  if (!showDetails) {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        <div className={`flex items-center gap-1 px-2 py-1 rounded-full border ${getTierColor(karma.tier)}`}>
          <span className="material-symbols-outlined text-[16px]">{getTierIcon(karma.tier)}</span>
          <span className="text-sm font-medium">{karma.score}</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`bg-white rounded-lg border border-gray-200 p-4 ${className}`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">Karma Score</h3>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${getTierColor(karma.tier)}`}>
          <span className="material-symbols-outlined text-[20px]">{getTierIcon(karma.tier)}</span>
          <span className="font-medium">{karma.tier}</span>
        </div>
      </div>

      <div className="space-y-4">
        {/* Score Display */}
        <div className="text-center">
          <div className="text-3xl font-bold text-gray-900 mb-1">{karma.score}</div>
          <div className="text-sm text-gray-500">Total Karma Points</div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Progress to next tier</span>
            <span>{getProgressToNextTier(karma.score, karma.tier)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${
                karma.tier === 'Gold' ? 'bg-yellow-500' :
                karma.tier === 'Silver' ? 'bg-gray-400' :
                karma.tier === 'Bronze' ? 'bg-orange-500' :
                'bg-blue-500'
              }`}
              style={{ width: `${getProgressToNextTier(karma.score, karma.tier)}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900">{karma.penaltyCount}</div>
            <div className="text-xs text-gray-500">Penalties</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900">
              {new Date(karma.lastUpdated).toLocaleDateString()}
            </div>
            <div className="text-xs text-gray-500">Last Updated</div>
          </div>
        </div>

        {/* Tier Benefits */}
        <div className="pt-2 border-t border-gray-100">
          <div className="text-sm font-medium text-gray-700 mb-2">Tier Benefits:</div>
          <div className="text-xs text-gray-600 space-y-1">
            {getTierBenefits(karma.tier).map((benefit, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="material-symbols-outlined text-green-500 text-[14px]">check_circle</span>
                {benefit}
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function getProgressToNextTier(score: number, currentTier: string): number {
  const tiers = {
    'Novice': { min: 0, max: 100 },
    'Bronze': { min: 100, max: 250 },
    'Silver': { min: 250, max: 500 },
    'Gold': { min: 500, max: 1000 }
  };

  const current = tiers[currentTier as keyof typeof tiers];
  if (!current || currentTier === 'Gold') return 100;

  const progress = ((score - current.min) / (current.max - current.min)) * 100;
  return Math.min(100, Math.max(0, progress));
}

function getTierBenefits(tier: string): string[] {
  switch (tier.toLowerCase()) {
    case 'gold':
      return [
        'Priority complaint processing',
        'Advanced analytics access',
        'Community moderator privileges',
        'Direct authority contact'
      ];
    case 'silver':
      return [
        'Faster complaint review',
        'Enhanced reporting tools',
        'Community recognition badge'
      ];
    case 'bronze':
      return [
        'Basic reporting tools',
        'Community participation',
        'Progress tracking'
      ];
    default:
      return [
        'Basic complaint filing',
        'Community access'
      ];
  }
}