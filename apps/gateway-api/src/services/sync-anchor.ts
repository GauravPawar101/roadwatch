import { fabricLedgerService } from './fabric-ledger.js';

export function isSyncAnchorMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = (env.COMPLAINT_WRITE_MODE ?? env.COMPLAINT_WRITE_MODE ?? 'outbox').trim().toLowerCase();
  return mode === 'sync-anchor' || mode === 'sync-anchor';
}

export async function maybeSyncAnchorComplaint(input: {
  complaintId: string;
  citizenId: string;
  roadId?: string | null;
  lat?: number | null;
  lng?: number | null;
  district?: string | null;
  zone?: string | null;
  merged?: boolean;
  reportCount?: number;
}): Promise<void> {
  if (!isSyncAnchorMode()) return;

  await fabricLedgerService.createComplaint({
    complaintId: input.complaintId,
    citizenId: input.citizenId,
    roadId: input.roadId ?? 'unknown-road',
    location: {
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      district: input.district ?? null,
      zone: input.zone ?? null
    },
    initialIPFSCid: '',
    authorityOrg: 'Org1MSP',
    merged: Boolean(input.merged),
    reportCount: input.reportCount ?? 1,
    eventIdempotencyKey: `sync-anchor:${input.complaintId}`
  });
}
