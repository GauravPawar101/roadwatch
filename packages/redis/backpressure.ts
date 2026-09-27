/**
 * Distributed rate limiting and backpressure.
 *
 * Superseded by ./admission.ts, which acquires a route permit and a global
 * permit in one atomic script — the previous implementation issued them as
 * separate INCR/EXPIRE/DECR sequences, six commands per write, and could admit
 * more concurrent requests than `maxInflight` allowed because the read and the
 * increment were not atomic.
 *
 * Kept as a re-export so existing callers keep working and route through the
 * script too. Nothing should import from this path directly; use ./admission.js.
 */
export {
  acquireDistributedBackpressurePermit,
  type DistributedBackpressureConfig,
  type DistributedBackpressurePermit
} from './admission.js';