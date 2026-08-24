import { acquireAdaptiveBackpressurePermit, type AdaptiveLimitBounds } from '@roadwatch/redis';

type ComplaintWriteAdmission = {
  release: () => Promise<void>;
};

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boundsFromEnv(): AdaptiveLimitBounds {
  const maxRequests = readPositiveInt(process.env.COMPLAINT_WRITE_MAX_PER_MINUTE, 120);
  const maxInflight = readPositiveInt(process.env.COMPLAINT_WRITE_MAX_INFLIGHT, 24);
  return {
    minRequestsPerWindow: readPositiveInt(process.env.COMPLAINT_WRITE_MIN_PER_MINUTE, Math.max(20, Math.floor(maxRequests / 4))),
    maxRequestsPerWindow: maxRequests,
    minInflight: readPositiveInt(process.env.COMPLAINT_WRITE_MIN_INFLIGHT, Math.max(4, Math.floor(maxInflight / 4))),
    maxInflight,
    windowSeconds: readPositiveInt(process.env.COMPLAINT_WRITE_WINDOW_SECONDS, 60),
    inflightTtlSeconds: readPositiveInt(process.env.COMPLAINT_WRITE_INFLIGHT_TTL_SECONDS, 120)
  };
}

export async function acquireComplaintWriteAdmission(input: {
  scope: string;
  principal: string;
}): Promise<ComplaintWriteAdmission> {
  return acquireAdaptiveBackpressurePermit({
    scope: input.scope,
    principal: input.principal,
    bounds: boundsFromEnv()
  });
}
