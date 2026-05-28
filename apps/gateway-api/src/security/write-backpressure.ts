import { acquireDistributedBackpressurePermit } from '@roadwatch/redis';

type ComplaintWriteAdmission = {
  release: () => Promise<void>;
};

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function acquireComplaintWriteAdmission(input: {
  scope: string;
  principal: string;
}): Promise<ComplaintWriteAdmission> {
  return acquireDistributedBackpressurePermit({
    scope: input.scope,
    principal: input.principal,
    maxRequestsPerWindow: readPositiveInt(process.env.COMPLAINT_WRITE_MAX_PER_MINUTE, 60),
    windowSeconds: readPositiveInt(process.env.COMPLAINT_WRITE_WINDOW_SECONDS, 60),
    maxInflight: readPositiveInt(process.env.COMPLAINT_WRITE_MAX_INFLIGHT, 16),
    inflightTtlSeconds: readPositiveInt(process.env.COMPLAINT_WRITE_INFLIGHT_TTL_SECONDS, 120)
  });
}