import { getReadCacheStats, readLoadSignals, resolveAdaptiveLimits } from '@roadwatch/redis';
import { pool } from '../postgres.js';

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function getAdmissionMetrics(): Promise<string> {
  const signals = await readLoadSignals();
  const maxRequests = readPositiveInt(process.env.COMPLAINT_WRITE_MAX_PER_MINUTE, 120);
  const maxInflight = readPositiveInt(process.env.COMPLAINT_WRITE_MAX_INFLIGHT, 24);
  const limits = await resolveAdaptiveLimits({
    minRequestsPerWindow: readPositiveInt(process.env.COMPLAINT_WRITE_MIN_PER_MINUTE, Math.max(20, Math.floor(maxRequests / 4))),
    maxRequestsPerWindow: maxRequests,
    minInflight: readPositiveInt(process.env.COMPLAINT_WRITE_MIN_INFLIGHT, Math.max(4, Math.floor(maxInflight / 4))),
    maxInflight,
    windowSeconds: readPositiveInt(process.env.COMPLAINT_WRITE_WINDOW_SECONDS, 60),
    inflightTtlSeconds: readPositiveInt(process.env.COMPLAINT_WRITE_INFLIGHT_TTL_SECONDS, 120)
  });

  let deadOutbox = 0;
  try {
    const deadRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM kafka_event_outbox WHERE status = 'DEAD'`
    );
    deadOutbox = Number.parseInt(deadRes.rows[0]?.count ?? '0', 10) || 0;
  } catch {
    // table may not exist yet
  }

  return [
    '# HELP roadwatch_outbox_unpublished Unpublished kafka_event_outbox rows (gauge).',
    '# TYPE roadwatch_outbox_unpublished gauge',
    `roadwatch_outbox_unpublished ${signals.outboxDepth}`,
    '# HELP roadwatch_outbox_dead Dead outbox rows awaiting manual redrive.',
    '# TYPE roadwatch_outbox_dead gauge',
    `roadwatch_outbox_dead ${deadOutbox}`,
    '# HELP roadwatch_admission_429_total Recent admission rejections in the last window.',
    '# TYPE roadwatch_admission_429_total gauge',
    `roadwatch_admission_429_total ${signals.recent429Count}`,
    '# HELP roadwatch_admission_5xx_total Recent upstream failures in the last window.',
    '# TYPE roadwatch_admission_5xx_total gauge',
    `roadwatch_admission_5xx_total ${signals.recent5xxCount}`,
    '# HELP roadwatch_admission_effective_max_per_window Adaptive max writes per window.',
    '# TYPE roadwatch_admission_effective_max_per_window gauge',
    `roadwatch_admission_effective_max_per_window ${limits.maxRequestsPerWindow}`,
    '# HELP roadwatch_admission_effective_max_inflight Adaptive max inflight writes.',
    '# TYPE roadwatch_admission_effective_max_inflight gauge',
    `roadwatch_admission_effective_max_inflight ${limits.maxInflight}`,
    '# HELP roadwatch_cache_hits_total Complaint list/heatmap cache hits since process start.',
    '# TYPE roadwatch_cache_hits_total counter',
    `roadwatch_cache_hits_total ${getReadCacheStats().hits}`,
    '# HELP roadwatch_cache_misses_total Complaint list/heatmap cache misses since process start.',
    '# TYPE roadwatch_cache_misses_total counter',
    `roadwatch_cache_misses_total ${getReadCacheStats().misses}`,
    ''
  ].join('\n');
}
