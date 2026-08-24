export { getRedisClient } from './client.js';
export { getRedisConfig, isRedisConfigured, type RedisConfig } from './config.js';
export { claimIdempotencyKey, type ClaimIdempotencyResult } from './idempotency.js';
export {
  bumpComplaintReadCache,
  getReadCacheStats,
  isReadCacheEnabled,
  readCachedJson,
  resetReadCacheStats,
  writeCachedJson
} from './read-cache.js';
export { acquireDistributedBackpressurePermit, type DistributedBackpressureConfig, type DistributedBackpressurePermit } from './backpressure.js';
export {
  acquireAdaptiveBackpressurePermit,
  readLoadSignals,
  recordAdmissionRejection,
  recordUpstreamFailure,
  resolveAdaptiveLimits,
  setOutboxDepthGauge,
  type AdaptiveLimitBounds,
  type AdaptiveLoadSignals
} from './adaptive-backpressure.js';

