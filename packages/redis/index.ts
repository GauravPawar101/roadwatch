export { getRedisClient } from './client.js';
export { getRedisConfig, isRedisConfigured, type RedisConfig } from './config.js';
export { claimIdempotencyKey, releaseIdempotencyKey, type ClaimIdempotencyResult } from './idempotency.js';
export {
  bumpComplaintReadCache,
  getReadCacheStats,
  isReadCacheEnabled,
  readCachedJson,
  resetReadCacheStats,
  writeCachedJson
} from './read-cache.js';
export {
  acquireAdmission,
  acquireDistributedBackpressurePermit,
  admissionRejection,
  permitKeys,
  type Admission,
  type AdmissionOutcome,
  type AdmissionRejection,
  type DistributedBackpressureConfig,
  type DistributedBackpressurePermit,
  type PermitCounters,
  type PermitLabel
} from './admission.js';
export {
  acquireAdaptiveBackpressurePermit,
  acquirePermitPair,
  readLoadSignals,
  recordAdmissionRejection,
  recordUpstreamFailure,
  resolveAdaptiveLimits,
  setOutboxDepthGauge,
  type AdaptiveLimitBounds,
  type AdaptiveLoadSignals
} from './adaptive-backpressure.js';

