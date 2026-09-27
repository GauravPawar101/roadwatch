import { Router } from '@roadwatch/core';
import { KafkaTopics, type ComplaintStatusChangedEvent, type ComplaintSubmittedEvent } from '@roadwatch/kafka';
import express from 'express';
import { z } from 'zod';
import { paginationShape } from '../http/pagination.js';
import { getContractorScorecard, trackAnalyticsEvent } from '../analytics/service.js';
import { buildRequestHash, claimIdempotency, deriveIdempotencyKey, releaseIdempotencyKey, storeIdempotencyResult } from '../idempotency.js';
import { enqueueKafkaEvent } from '../kafka/outbox.js';
import { createAndFanoutNotification } from '../notifications/service.js';
import { sql as pool, sqlFragment } from '../postgres.js'; // `sql` executes; `sqlFragment` composes
import { assertDistrictAccess, assertZoneAccess, requireAuth, requireRole } from '../rbac.js';
import { broadcastComplaintEvent } from '../realtime/sse.js';
import { fabricLedgerService } from '../services/fabric-ledger.js';
import {
  awardValidSubmissionKarma,
  ensureSlaTracking,
  haversineMeters,
  shouldEscalateOnMerge,
  slaHoursForRoadType,
  rewardOrgForRepair,
} from '../services/complaint-lifecycle.js';
import { bumpComplaintReadCache } from '@roadwatch/redis';
import { maybeSyncAnchorComplaint } from '../services/sync-anchor.js';
import { uuidv7 } from '../uuid.js';

const MERGE_RADIUS_M = 100;

/**
 * Statuses a complaint can no longer be merged into.
 *
 * Set membership rather than an inline array literal: this is evaluated once per
 * candidate row inside the dedupe scan, and `Array.includes` on a fresh literal
 * allocates on every call.
 */
const MERGE_CLOSED_STATUSES = new Set(['RESOLVED', 'DISMISSED', 'CLOSED']);

/**
 * How many times the dedupe rescan will retry when the merge target turns out to
 * be stale under the lock.
 *
 * Re-verification only fails when a concurrent writer resolved or removed the row
 * between the scan and the lock, so a stale candidate is rare and one retry is
 * normally enough. Three leaves room for a burst without letting a write spin:
 * the loop is bounded, and exhaustion returns a retryable 503 rather than
 * splitting a report that should have been merged.
 */
const MERGE_SCAN_ATTEMPTS = 3;
const MERGE_SLA_WINDOW_MS = (roadTypeOrId?: string) => slaHoursForRoadType(roadTypeOrId ?? 'URBAN') * 60 * 60 * 1000;

const router = Router();

function toRad(v: number) {
  return (v * Math.PI) / 180;
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function normalizeComplaintStatus(status: string | null | undefined): string {
  switch (String(status ?? '').toUpperCase()) {
    case 'FILED':
    case 'OPEN':
      return 'Open';
    case 'IN_PROGRESS':
    case 'INPROGRESS':
      return 'InProgress';
    case 'RESOLVED':
      return 'Resolved';
    case 'DISMISSED':
      return 'Dismissed';
    case 'ESCALATED':
      return 'Escalated';
    default:
      return String(status ?? '');
  }
}

// ---------------------------------------------------------------------------
// Helper: write an audit log entry
// ---------------------------------------------------------------------------
async function writeAudit(
  actorUserId: string,
  actorPhoneHash: string,
  actorPhoneMasked: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>
): Promise<void> {
  await pool`
    INSERT INTO audit_log (
      id, actor_user_id, actor_phone_hash, actor_phone_masked, 
      action, target_type, target_id, details, created_at
    ) VALUES (
      ${uuidv7()}, ${actorUserId}, ${actorPhoneHash}, ${actorPhoneMasked}, 
      ${action}, ${targetType}, ${targetId}, ${JSON.stringify(details)}, NOW()
    )
  `;
}

// ---------------------------------------------------------------------------
// POST /complaints — idempotent create with proximity merge, SLA + karma
// ---------------------------------------------------------------------------
router.post('/complaints', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as {
    sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[];
  };

  const body = z
    .object({
      id: z.string().min(1).optional(),
      district: z.string().min(1),
      zone: z.string().min(1),
      description: z.string().min(1),
      lat: z.number().optional().nullable(),
      lng: z.number().optional().nullable(),
      severity: z.number().int().min(1).max(5).optional().default(3),
      capturedLat: z.number().optional().nullable(),
      capturedLng: z.number().optional().nullable(),
    })
    .parse(req.body);

  if (!assertDistrictAccess(user as any, body.district) || !assertZoneAccess(user as any, body.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (
    body.lat != null && body.lng != null &&
    body.capturedLat != null && body.capturedLng != null
  ) {
    const captureDistance = haversineMeters(
      { lat: body.lat, lng: body.lng },
      { lat: body.capturedLat, lng: body.capturedLng }
    );
    if (captureDistance > 80) {
      return res.status(400).json({
        error: 'Capture location must match complaint location',
        captureDistanceM: Math.round(captureDistance),
      });
    }
  }

  const idempotencyKey = deriveIdempotencyKey(req, 'authority:complaints:create');
  const requestHash = buildRequestHash({ actor: user.sub, body });
  const claimed = await claimIdempotency('authority:complaints:create', idempotencyKey, requestHash);
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  // From here on the claim is held. Anything that throws before
  // storeIdempotencyResult would otherwise leave it incomplete, and an
  // incomplete claim is not reclaimable by the caller — auto-derived keys hash
  // the body, so a retry with any changed field derives a different key and the
  // original complaint becomes permanently unwritable. Release on the way out.
  try {
  let id = body.id ?? uuidv7();
  let merged = false;
  let escalated = false;
  let reportCount = 1;
  let mergeReason: string | null = null;
  let status = 'FILED';
  // Live SSE pushes, flushed only once the transaction has committed.
  const deferredBroadcasts: Array<() => void> = [];

  await pool.begin(async (tx: any) => {
    if (body.lat != null && body.lng != null) {
      const target = { lat: Number(body.lat), lng: Number(body.lng) };
      const withinMergeRadius = (row: any): boolean =>
        row.lat != null &&
        row.lng != null &&
        haversineMeters(target, { lat: Number(row.lat), lng: Number(row.lng) }) <= MERGE_RADIUS_M;
      const isMergeable = (row: any): boolean => !MERGE_CLOSED_STATUSES.has(String(row.status ?? '').toUpperCase());

      // Two-phase dedupe: find the merge target without locking anything, then
      // lock only that one row, then re-verify it under the lock.
      //
      // The previous query was a single `LIMIT 25 ... FOR UPDATE`, which locks
      // the 25 newest rows *in the district/zone*. Every concurrent write to the
      // same district/zone therefore queued on the same 25 rows, which is why
      // adding gateway instances made this worse rather than better: the lock
      // lives in Postgres, keyed by district/zone, so a second instance contends
      // on exactly the same rows. Measured on the hot partition, p50 was 794 ms
      // against 55.6 ms spread over 200 partitions — 14x — and every waiting
      // backend was on a row lock rather than on CPU or disk.
      //
      // The unlocked scan is a plain MVCC read: no row locks, so writers in the
      // same partition no longer serialise. Correctness is preserved by locking
      // the single row actually merged into, and re-checking under that lock,
      // because a candidate can be resolved or removed between the scan and the
      // lock.
      // Tracks whether a candidate was found and then rejected under the lock.
      // Only that case is a genuine contention failure. "No candidate within the
      // radius" is the ordinary path to a new row, and must not be mistaken for
      // contention — an earlier version of this conflated the two and answered
      // 503 for every write outside the radius in a busy partition.
      let staleCandidateSeen = false;

      for (let attempt = 0; attempt < MERGE_SCAN_ATTEMPTS; attempt += 1) {
        const candidates = await tx`
          SELECT id, status, report_count, created_at, updated_at, lat, lng
          FROM complaints
          WHERE district = ${body.district}
            AND zone = ${body.zone}
            AND lat IS NOT NULL AND lng IS NOT NULL
            AND UPPER(status) NOT IN ('RESOLVED', 'DISMISSED', 'CLOSED')
          ORDER BY created_at DESC
          LIMIT 25
        `;

        const near = (candidates as any[]).find(
          (row) => withinMergeRadius(row) && isMergeable(row),
        );
        // Nothing within the radius: no lock is needed at all, and a new row is
        // the right outcome. Two simultaneous first reports at the same spot
        // create two rows, which is also what the previous version did — neither
        // could see the other's uncommitted insert.
        if (!near) break;

        // Lock exactly one row: the one that will be merged into.
        const locked = await tx`
          SELECT id, status, report_count, created_at, updated_at, lat, lng
          FROM complaints
          WHERE id = ${near.id}
          FOR UPDATE
        `;
        const row = (locked as any[])[0];

        // Re-verify under the lock. READ COMMITTED gives each statement a fresh
        // snapshot, so this sees any commit that landed while we were scanning.
        // A row that was resolved or deleted in the meantime is not a valid
        // merge target, and merging into it would corrupt report_count.
        if (!row || !withinMergeRadius(row) || !isMergeable(row)) {
          staleCandidateSeen = true;
          continue;
        }

        const decision = shouldEscalateOnMerge(row, MERGE_SLA_WINDOW_MS());
        merged = true;
        id = String(row.id);
        mergeReason = decision.reason;
        escalated = decision.escalate;
        status = escalated ? 'ESCALATED' : String(row.status ?? 'FILED');

        const updated = await tx`
          UPDATE complaints
          SET report_count = COALESCE(report_count, 1) + 1,
              status = ${status},
              description = CASE
                WHEN ${escalated} THEN ${body.description}
                ELSE description
              END,
              updated_at = NOW()
          WHERE id = ${id}
          RETURNING report_count
        `;
        reportCount = Number(updated[0]?.report_count ?? 2);

        if (escalated) {
          const event: ComplaintStatusChangedEvent = {
            type: 'complaint-status-changed',
            idempotencyKey: `complaint:${id}:status:merge-escalate`,
            occurredAt: new Date().toISOString(),
            version: 1,
            complaintId: id,
            fromStatus: String(row.status ?? 'FILED'),
            toStatus: 'ESCALATED',
            changedBy: { actorType: 'system', actorId: user.sub },
          };
          await enqueueKafkaEvent(tx, KafkaTopics.complaintStatusChanged, event, {
            key: id,
            idempotencyKey: event.idempotencyKey,
          });
        }
        break;
      }

      // Only a candidate that went stale under the lock counts as contention.
      // Inserting after a genuinely contended scan would risk splitting a report
      // that should have been merged, so the caller is asked to retry. The
      // idempotency claim is released on the way out, so a retry is an ordinary
      // request rather than a permanently failed one.
      if (!merged && staleCandidateSeen) {
        const error: any = new Error('Complaint merge target changed during this request; please retry');
        error.statusCode = 503;
        error.retryAfterSeconds = 1;
        throw error;
      }
    }

    if (!merged) {
      await tx`
        INSERT INTO complaints (id, district, zone, status, description, lat, lng, user_id, report_count, created_at, updated_at)
        VALUES (${id}, ${body.district}, ${body.zone}, 'FILED', ${body.description}, ${body.lat ?? null}, ${body.lng ?? null}, ${user.sub}, 1, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `;

      const event: ComplaintSubmittedEvent = {
        type: 'complaint-submitted',
        idempotencyKey: `complaint:${id}:submitted`,
        occurredAt: new Date().toISOString(),
        version: 1,
        complaintId: id,
        district: body.district,
        zone: body.zone,
        lat: body.lat ?? undefined,
        lng: body.lng ?? undefined,
        description: body.description,
        roadId: `${body.district}:${body.zone}`,
        authorityOrg: body.zone,
        citizenId: user.sub,
        location: { district: body.district, zone: body.zone, lat: body.lat ?? null, lng: body.lng ?? null },
        merged: false,
        reportCount: 1,
      };

      await enqueueKafkaEvent(tx, KafkaTopics.complaintSubmitted, event, {
        key: id,
        idempotencyKey: event.idempotencyKey,
      });
    }

    // SLA tracking drives breach detection, so a complaint without it is never
    // escalated. It belongs in the same transaction as the complaint, and reads
    // the complaint row through the transaction's own snapshot.
    if (!merged) {
      await ensureSlaTracking(id, { severity: body.severity }, tx);
    } else if (escalated) {
      // Shorten remaining SLA on escalation (half window)
      await ensureSlaTracking(id, {
        severity: body.severity,
        deadline: new Date(Date.now() + (MERGE_SLA_WINDOW_MS() / 2)),
      }, tx);
    }

    // The notification is business data, not a side effect: a citizen filing a
    // complaint and the resulting notification either both exist or neither
    // does. It previously ran on its own transaction *after* this one
    // committed, so a failure there produced a 500 for a complaint that was
    // already durable — and the caller's retry merged into it, taking one
    // report to report_count 2.
    await createAndFanoutNotification({
      message: {
        type: escalated ? 'status_change' : 'new_complaint',
        title: escalated
          ? `Complaint ${id} escalated`
          : merged
            ? `Complaint merged into ${id}`
            : `New complaint ${id}`,
        body: escalated
          ? `SLA-based escalation for ${body.district} / ${body.zone}.`
          : merged
            ? `Nearby report merged (count=${reportCount}).`
            : `New complaint filed in ${body.district} / ${body.zone}.`,
        data: { complaintId: id, district: body.district, zone: body.zone, merged, escalated, reportCount },
        audience: { kind: 'jurisdiction', district: body.district, zone: body.zone },
        critical: escalated,
      },
      tx,
      deferBroadcasts: deferredBroadcasts,
    });
  });

  // Best-effort from here: these are observability and scoring, not the record
  // of the complaint. Throwing would return a 500 for an already-committed
  // write, and the caller's retry would merge into the complaint it just made.
  await awardValidSubmissionKarma(user.sub, id).catch(error => {
    console.error('[authority] karma award failed for complaint', id, error);
  });

  await writeAudit(
    user.sub,
    user.phoneHash,
    user.phone,
    escalated ? 'COMPLAINT_ESCALATED' : merged ? 'COMPLAINT_MERGED' : 'COMPLAINT_CREATED',
    'complaint',
    id,
    { district: body.district, zone: body.zone, merged, escalated, reportCount, mergeReason }
  ).catch(error => {
    console.error('[authority] audit write failed for complaint', id, error);
  });

  // Analytics and audit are observability, not business data. They run after
  // the transaction has committed and are explicitly best-effort: if they threw,
  // the caller would see a 500 for a complaint that already exists, and the
  // retry would merge into it and double-count the report. Losing an analytics
  // row is recoverable; corrupting report_count is not.
  await trackAnalyticsEvent({
    type: escalated ? 'COMPLAINT_ESCALATED' : 'COMPLAINT_CREATED',
    actorUserId: user.sub,
    complaintId: id,
    district: body.district,
    zone: body.zone,
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    properties: { status, merged, escalated, reportCount, mergeReason },
  }).catch(error => {
    console.error('[authority] analytics event failed for complaint', id, error);
  });

  // Flush live notification pushes now that the transaction has committed.
  for (const flush of deferredBroadcasts) {
    try {
      flush();
    } catch (error) {
      console.error('[authority] notification broadcast failed for complaint', id, error);
    }
  }

  const responseBody = {
    ok: true,
    merged,
    escalated,
    reportCount,
    mergeReason,
    complaint: {
      id,
      district: body.district,
      zone: body.zone,
      status,
      description: body.description,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      updatedAt: new Date().toISOString(),
    },
  };
  await storeIdempotencyResult(claimed, 200, responseBody);
  await bumpComplaintReadCache();
  await maybeSyncAnchorComplaint({
    complaintId: id,
    citizenId: user.sub,
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    district: body.district,
    zone: body.zone,
    merged,
    reportCount
  });
  res.json(responseBody);
  } catch (error) {
    // The claim is dropped so the caller can retry immediately.
    //
    // Everything that makes up the complaint record — the complaint row, the
    // merge counter, SLA tracking, the notification and the Kafka outbox event
    // — is written inside one transaction, so reaching here means none of it
    // committed and the retry starts clean. Only the post-commit observability
    // writes (audit, analytics, karma) sit outside, and those are explicitly
    // best-effort so they cannot turn a durable write into a 500.
    await releaseIdempotencyKey(claimed);
    throw error;
  }
});

// ---------------------------------------------------------------------------
// POST /complaints/:id/repair-verification
// ---------------------------------------------------------------------------
router.post('/complaints/:id/repair-verification', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z
    .object({
      beforeSha256: z.string().min(10),
      afterSha256: z.string().min(10),
      imageLat: z.number(),
      imageLng: z.number(),
      currentLat: z.number(),
      currentLng: z.number(),
      model: z.string().optional().default('roadwatch-repair-ai-v1')
    })
    .parse(req.body);

  const [row] = await pool`
    SELECT id, district, zone, lat, lng FROM complaints WHERE id = ${params.id} LIMIT 1
  `;
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const liveToImageDistanceM = distanceMeters(
    { lat: body.currentLat, lng: body.currentLng },
    { lat: body.imageLat, lng: body.imageLng }
  );
  const complaintDistanceM = row.lat != null && row.lng != null
    ? distanceMeters({ lat: Number(row.lat), lng: Number(row.lng) }, { lat: body.currentLat, lng: body.currentLng })
    : liveToImageDistanceM;

  const hashChangedScore = body.beforeSha256 !== body.afterSha256 ? 0.55 : 0.2;
  const locationScore = Math.max(0, 1 - complaintDistanceM / 120) * 0.45;
  const aiScore = Math.max(0, Math.min(1, hashChangedScore + locationScore));
  const repaired = aiScore >= 0.62 && complaintDistanceM <= 120;

  await pool`
    INSERT INTO complaint_repair_verifications (
      complaint_id, before_sha256, after_sha256, image_lat, image_lng, current_lat, current_lng,
      distance_m, ai_score, repaired, model, details, verified_by_user_id, verified_at
    ) VALUES (
      ${params.id}, ${body.beforeSha256}, ${body.afterSha256}, ${body.imageLat}, ${body.imageLng}, 
      ${body.currentLat}, ${body.currentLng}, ${complaintDistanceM}, ${aiScore}, ${repaired}, 
      ${body.model}, ${JSON.stringify({ liveToImageDistanceM, complaintDistanceM })}, ${user.sub}, NOW()
    )
    ON CONFLICT (complaint_id) DO UPDATE
      SET before_sha256        = EXCLUDED.before_sha256,
          after_sha256         = EXCLUDED.after_sha256,
          image_lat            = EXCLUDED.image_lat,
          image_lng            = EXCLUDED.image_lng,
          current_lat          = EXCLUDED.current_lat,
          current_lng          = EXCLUDED.current_lng,
          distance_m           = EXCLUDED.distance_m,
          ai_score             = EXCLUDED.ai_score,
          repaired             = EXCLUDED.repaired,
          model                = EXCLUDED.model,
          details              = EXCLUDED.details,
          verified_by_user_id  = EXCLUDED.verified_by_user_id,
          verified_at          = NOW()
  `;

  await writeAudit(user.sub, user.phoneHash, user.phone, 'REPAIR_AI_VERIFIED', 'complaint', params.id, { repaired, aiScore, complaintDistanceM, model: body.model });

  res.json({ ok: true, repaired, aiScore, complaintDistanceM });
});

// ---------------------------------------------------------------------------
// POST /complaints/:id/status
// ---------------------------------------------------------------------------
router.post('/complaints/:id/status', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ status: z.string().min(1) }).parse(req.body);

  const [row] = await pool`
    SELECT id, district, zone, status, description, lat, lng FROM complaints WHERE id = ${params.id} LIMIT 1
  `;
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (row.status === body.status) return res.json({ ok: true, unchanged: true });

  if (String(body.status).toUpperCase() === 'RESOLVED') {
    const [v] = await pool`
      SELECT repaired, ai_score, distance_m, verified_at FROM complaint_repair_verifications WHERE complaint_id = ${params.id} LIMIT 1
    `;
    if (!v || !v.repaired) {
      return res.status(400).json({ error: 'Complaint cannot be resolved before repair verification passes', verification: v ?? null });
    }
  }

  let u: any;
  await pool.begin(async (tx: any) => {
    await tx`
      UPDATE complaints SET status = ${body.status}, updated_at = NOW() WHERE id = ${params.id}
    `;

    const event: ComplaintStatusChangedEvent = {
      type: 'complaint-status-changed',
      idempotencyKey: `complaint:${params.id}:status:${row.status}->${body.status}`,
      occurredAt: new Date().toISOString(),
      version: 1,
      complaintId: params.id,
      fromStatus: row.status,
      toStatus: body.status,
      changedBy: { actorType: 'authority', actorId: user.sub }
    };
    await enqueueKafkaEvent(tx, KafkaTopics.complaintStatusChanged, event, { key: params.id, idempotencyKey: event.idempotencyKey });

    await writeAudit(user.sub, user.phoneHash, user.phone, 'COMPLAINT_STATUS_CHANGED', 'complaint', params.id, { from: row.status, to: body.status });

    await trackAnalyticsEvent({
      type: 'COMPLAINT_STATUS_CHANGED',
      actorUserId: user.sub,
      complaintId: params.id,
      district: row.district,
      zone: row.zone,
      lat: row.lat ?? null,
      lng: row.lng ?? null,
      properties: { from: row.status, to: body.status }
    });

    [u] = await tx`
      SELECT id, district, zone, status, description, lat, lng, updated_at FROM complaints WHERE id = ${params.id} LIMIT 1
    `;
  });

  if (u) {
    broadcastComplaintEvent({
      type: 'complaint_updated',
      complaint: { id: u.id, district: u.district, zone: u.zone, status: u.status, description: u.description, lat: u.lat, lng: u.lng, updatedAt: new Date(u.updated_at).toISOString() }
    });

    await createAndFanoutNotification({
      message: {
        type: 'status_change',
        title: `Complaint ${u.id} status changed`,
        body: `Status updated to ${u.status} for a complaint in ${u.district} / ${u.zone}.`,
        data: { complaintId: u.id, district: u.district, zone: u.zone, status: u.status },
        audience: { kind: 'jurisdiction', district: u.district, zone: u.zone },
        critical: false
      }
    });
  }

  await bumpComplaintReadCache();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /complaints/:id/escalate
// ---------------------------------------------------------------------------
router.post('/complaints/:id/escalate', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ reason: z.string().optional() }).parse(req.body);

  const [row] = await pool`
    SELECT id, district, zone, status, description, lat, lng FROM complaints WHERE id = ${params.id} LIMIT 1
  `;
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (row.status === 'ESCALATED') return res.json({ ok: true, unchanged: true });

  let u: any;
  await pool.begin(async (tx: any) => {
    await tx`
      UPDATE complaints SET status = 'ESCALATED', updated_at = NOW() WHERE id = ${params.id}
    `;

    const event: ComplaintStatusChangedEvent = {
      type: 'complaint-status-changed',
      idempotencyKey: `complaint:${params.id}:status:${row.status}->ESCALATED`,
      occurredAt: new Date().toISOString(),
      version: 1,
      complaintId: params.id,
      fromStatus: row.status,
      toStatus: 'ESCALATED',
      changedBy: { actorType: 'authority', actorId: user.sub }
    };
    await enqueueKafkaEvent(tx, KafkaTopics.complaintStatusChanged, event, { key: params.id, idempotencyKey: event.idempotencyKey });

    await writeAudit(user.sub, user.phoneHash, user.phone, 'COMPLAINT_ESCALATED', 'complaint', params.id, { reason: body.reason ?? null });

    await trackAnalyticsEvent({
      type: 'COMPLAINT_ESCALATED',
      actorUserId: user.sub,
      complaintId: params.id,
      district: row.district,
      zone: row.zone,
      lat: row.lat ?? null,
      lng: row.lng ?? null,
      properties: { reason: body.reason ?? null }
    });

    [u] = await tx`
      SELECT id, district, zone, status, description, lat, lng, updated_at FROM complaints WHERE id = ${params.id} LIMIT 1
    `;
  });

  if (u) {
    broadcastComplaintEvent({
      type: 'complaint_updated',
      complaint: { id: u.id, district: u.district, zone: u.zone, status: u.status, description: u.description, lat: u.lat, lng: u.lng, updatedAt: new Date(u.updated_at).toISOString() }
    });

    await createAndFanoutNotification({
      message: {
        type: 'escalation',
        title: `Complaint ${u.id} escalated`,
        body: `Escalation raised for ${u.district} / ${u.zone}.`,
        data: { complaintId: u.id, district: u.district, zone: u.zone, reason: body.reason ?? null },
        audience: { kind: 'jurisdiction', district: u.district, zone: u.zone },
        critical: true
      }
    });
  }

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /complaints/:id/sla-warning
// ---------------------------------------------------------------------------
router.post('/complaints/:id/sla-warning', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ message: z.string().optional() }).parse(req.body);

  const [row] = await pool`
    SELECT id, district, zone, status FROM complaints WHERE id = ${params.id} LIMIT 1
  `;
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await writeAudit(user.sub, user.phoneHash, user.phone, 'SLA_WARNING', 'complaint', params.id, { status: row.status });

  await trackAnalyticsEvent({
    type: 'SLA_WARNING',
    actorUserId: user.sub,
    complaintId: params.id,
    district: row.district,
    zone: row.zone,
    properties: { status: row.status, message: body.message ?? null }
  });

  await createAndFanoutNotification({
    message: {
      type: 'sla_warning',
      title: `SLA warning for ${row.id}`,
      body: body.message ?? `SLA risk detected for a complaint in ${row.district} / ${row.zone}.`,
      data: { complaintId: row.id, district: row.district, zone: row.zone, status: row.status },
      audience: { kind: 'jurisdiction', district: row.district, zone: row.zone },
      critical: true
    }
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /complaints
// ---------------------------------------------------------------------------
router.get('/complaints', requireAuth, async (req, res) => {
  const user = (req as any).user as { role: string; districts: string[]; zones: string[] };

  const query = z
    .object({
      district: z.string().optional(),
      zone: z.string().optional(),
      status: z.string().optional(),
      // Previously accepted by clients and ignored: the SQL below carried a
      // hardcoded LIMIT 200, so a request for 20 rows received 200. See
      // ./pagination.ts for what that cost.
      ...paginationShape,
    })
    .parse(req.query);

  let districtCondition = sqlFragment``;
  if (query.district) {
    if (!assertDistrictAccess(user as any, query.district)) return res.status(403).json({ error: 'Forbidden' });
    districtCondition = sqlFragment`AND district = ${query.district}`;
  } else if (user.role !== 'CE' && !user.districts.includes('ALL') && user.districts.length) {
    districtCondition = sqlFragment`AND district = ANY(${user.districts})`;
  }

  let zoneCondition = sqlFragment``;
  if (query.zone) {
    if (!assertZoneAccess(user as any, query.zone)) return res.status(403).json({ error: 'Forbidden' });
    zoneCondition = sqlFragment`AND zone = ${query.zone}`;
  } else if (user.role !== 'CE' && !user.zones.includes('ALL') && user.zones.length) {
    zoneCondition = sqlFragment`AND zone = ANY(${user.zones})`;
  }

  const statusCondition = query.status ? sqlFragment`AND status = ${query.status}` : sqlFragment``;

  // The LIMIT and OFFSET are parameters, not literals, so a caller cannot inject
  // either and the planner still gets a bound it can plan against.
  const list = await pool`
    SELECT id, district, zone, status, description, lat, lng, created_at, updated_at, fabric_txid
    FROM complaints
    WHERE 1=1
    ${districtCondition}
    ${zoneCondition}
    ${statusCondition}
    ORDER BY created_at DESC
    LIMIT ${query.limit} OFFSET ${query.offset}
  `;

  // postgres.js returns camelCased fields natively if configured. Mapping manually back to old output contract if necessary.
  const mappedList = list.map((c: any) => ({
    id: c.id,
    district: c.district,
    zone: c.zone,
    status: c.status,
    description: c.description,
    lat: c.lat,
    lng: c.lng,
    created_at: c.createdAt ?? c.created_at,
    updated_at: c.updatedAt ?? c.updated_at,
    fabric_txid: c.fabricTxid ?? c.fabric_txid
  }));

  // Pagination is reported, so a client can tell a short page from the end of
  // the data. `hasMore` is a hint rather than a count: it costs nothing, and a
  // COUNT(*) per request would undo the saving this whole change is about.
  const hasMore = mappedList.length === query.limit;

  res.json({
    complaints: mappedList,
    pagination: { limit: query.limit, offset: query.offset, returned: mappedList.length, hasMore }
  });
});

// ---------------------------------------------------------------------------
// GET /complaints/:id/history
// ---------------------------------------------------------------------------
router.get('/complaints/:id/history', requireAuth, async (req, res) => {
  const user = (req as any).user as { role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);

  const [row] = await pool`
    SELECT district, zone FROM complaints WHERE id = ${params.id} LIMIT 1
  `;
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const history = await fabricLedgerService.getComplaintHistory(params.id);
  res.json({ complaintId: params.id, history });
});

// ---------------------------------------------------------------------------
// POST /complaints/:id/resolve
// ---------------------------------------------------------------------------
router.post('/complaints/:id/resolve', requireAuth, async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ resolutionNote: z.string().optional() }).parse(req.body);

  const [row] = await pool`
    SELECT id, district, zone, status, description, lat, lng, authority_org, authority_id, road_id FROM complaints WHERE id = ${params.id} LIMIT 1
  `;
  if (!row) return res.status(404).json({ error: 'Not found' });

  const fullUser = (req as any).user as any;
  if (!assertDistrictAccess(fullUser, row.district) || !assertZoneAccess(fullUser, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (row.status === 'RESOLVED') return res.json({ ok: true, unchanged: true });

  const [v] = await pool`
    SELECT repaired, ai_score, distance_m, verified_at FROM complaint_repair_verifications WHERE complaint_id = ${params.id} LIMIT 1
  `;
  if (!v || !v.repaired) {
    return res.status(400).json({ error: 'Complaint cannot be resolved before repair verification passes', verification: v ?? null });
  }

  let u: any;
  await pool.begin(async (tx: any) => {
    await tx`
      UPDATE complaints SET status = 'RESOLVED', updated_at = NOW() WHERE id = ${params.id}
    `;

    try {
      await tx`
        UPDATE complaint_assignments
        SET inspection_completed_at = NOW(),
            status = 'VERIFIED'
        WHERE complaint_id = ${params.id}
      `;
    } catch {
      // inspection columns may be missing on older DBs
    }

    const event: ComplaintStatusChangedEvent = {
      type: 'complaint-status-changed',
      idempotencyKey: `complaint:${params.id}:status:${row.status}->RESOLVED`,
      occurredAt: new Date().toISOString(),
      version: 1,
      complaintId: params.id,
      fromStatus: row.status,
      toStatus: 'RESOLVED',
      changedBy: { actorType: 'authority', actorId: user.sub }
    };
    await enqueueKafkaEvent(tx, KafkaTopics.complaintStatusChanged, event, { key: params.id, idempotencyKey: event.idempotencyKey });

    await writeAudit(user.sub, user.phoneHash, user.phone, 'COMPLAINT_RESOLVED', 'complaint', params.id, { resolutionNote: body.resolutionNote ?? null });

    await trackAnalyticsEvent({
      type: 'COMPLAINT_RESOLVED',
      actorUserId: user.sub,
      complaintId: params.id,
      district: row.district,
      zone: row.zone,
      lat: row.lat ?? null,
      lng: row.lng ?? null,
      properties: { resolutionNote: body.resolutionNote ?? null }
    });

    [u] = await tx`
      SELECT id, district, zone, status, description, lat, lng, updated_at FROM complaints WHERE id = ${params.id} LIMIT 1
    `;
  });

  if (u) {
    broadcastComplaintEvent({
      type: 'complaint_resolved',
      complaint: { id: u.id, district: u.district, zone: u.zone, status: u.status, description: u.description, lat: u.lat, lng: u.lng, updatedAt: new Date(u.updated_at).toISOString() }
    });

    await rewardOrgForRepair(row.authority_org ?? row.authority_id ?? null, params.id).catch(() => null);

    await createAndFanoutNotification({
      message: {
        type: 'resolved',
        title: `Complaint ${u.id} resolved`,
        body: `A complaint in ${u.district} / ${u.zone} was marked RESOLVED.`,
        data: { complaintId: u.id, district: u.district, zone: u.zone, status: u.status },
        audience: { kind: 'jurisdiction', district: u.district, zone: u.zone },
        critical: false
      }
    });
  }

  await bumpComplaintReadCache();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /complaints/:id/assign
// ---------------------------------------------------------------------------
router.post('/complaints/:id/assign', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z
    .object({
      contractorId: z.string().min(1),
      expectedResolutionDays: z.coerce.number().int().positive().optional(),
      notes: z.string().max(500).optional()
    })
    .parse(req.body);

  const [row] = await pool`
    SELECT id, district, zone, status, lat, lng FROM complaints WHERE id = ${params.id} LIMIT 1
  `;
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const [contractor] = await pool`
    SELECT id, name FROM contractors WHERE id = ${body.contractorId} LIMIT 1
  `;
  if (!contractor) return res.status(400).json({ error: 'Unknown contractorId' });

  await pool`
    INSERT INTO complaint_assignments (
      complaint_id, contractor_id, expected_resolution_days, assigned_by_user_id, assigned_at, notes
    ) VALUES (
      ${params.id}, ${body.contractorId}, ${body.expectedResolutionDays ?? null}, ${user.sub}, NOW(), ${body.notes ?? null}
    )
    ON CONFLICT (complaint_id) DO UPDATE
      SET contractor_id             = EXCLUDED.contractor_id,
          expected_resolution_days  = EXCLUDED.expected_resolution_days,
          assigned_by_user_id       = EXCLUDED.assigned_by_user_id,
          assigned_at               = NOW(),
          notes                     = EXCLUDED.notes
  `;

  await writeAudit(user.sub, user.phoneHash, user.phone, 'COMPLAINT_ASSIGNED', 'complaint', params.id, { contractorId: body.contractorId, expectedResolutionDays: body.expectedResolutionDays ?? null });

  await trackAnalyticsEvent({
    type: 'COMPLAINT_ASSIGNED',
    actorUserId: user.sub,
    complaintId: params.id,
    contractorId: body.contractorId,
    district: row.district,
    zone: row.zone,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    properties: { expectedResolutionDays: body.expectedResolutionDays ?? null, notes: body.notes ?? null }
  });

  await createAndFanoutNotification({
    message: {
      type: 'assignment',
      title: `Complaint ${params.id} assigned`,
      body: `Assigned to contractor ${body.contractorId} in ${row.district} / ${row.zone}.`,
      data: { complaintId: params.id, district: row.district, zone: row.zone, contractorId: body.contractorId },
      audience: { kind: 'jurisdiction', district: row.district, zone: row.zone },
      critical: false
    }
  });

  res.json({ ok: true });
});

router.post('/complaints/:id/unassign', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);

  const [row] = await pool`
    SELECT id, district, zone, status, lat, lng FROM complaints WHERE id = ${params.id} LIMIT 1
  `;
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await pool`
    UPDATE complaint_assignments
       SET contractor_id = NULL,
           contractor_user_id = NULL,
           status = 'UNASSIGNED',
           progress_pct = 0,
           progress_note = 'unassigned by authority',
           reviewed_at = NOW(),
           review_decision = 'UNASSIGNED',
           review_note = 'Authority unassigned the complaint'
     WHERE complaint_id = ${params.id}
  `;

  await writeAudit(user.sub, user.phoneHash, user.phone, 'COMPLAINT_UNASSIGNED', 'complaint', params.id, {});

  await trackAnalyticsEvent({
    type: 'COMPLAINT_ASSIGNED',
    actorUserId: user.sub,
    complaintId: params.id,
    district: row.district,
    zone: row.zone,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    properties: {}
  });

  await createAndFanoutNotification({
    message: {
      type: 'assignment',
      title: `Complaint ${params.id} unassigned`,
      body: `Complaint was unassigned in ${row.district} / ${row.zone}.`,
      data: { complaintId: params.id, district: row.district, zone: row.zone, contractorId: null },
      audience: { kind: 'jurisdiction', district: row.district, zone: row.zone },
      critical: false
    }
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /analytics
// ---------------------------------------------------------------------------
router.get('/analytics', requireAuth, async (req, res) => {
  const analyticsRows = await pool`
    SELECT status, COUNT(*)::int AS count
    FROM complaints
    GROUP BY status
  `;

  const byStatus: Record<string, number> = {};
  for (const row of analyticsRows) {
    byStatus[row.status] = row.count;
  }

  const [typeRows, severityRows, trendRows, resolutionRows] = await Promise.all([
    pool`
      SELECT COALESCE(metadata->>'damageType', 'Unknown') AS type, COUNT(*)::int AS count
      FROM complaints
      GROUP BY COALESCE(metadata->>'damageType', 'Unknown')
      ORDER BY count DESC, type ASC
      LIMIT 5
    `,
    pool`
      SELECT COALESCE((metadata->>'severity')::int, 0) AS severity, COUNT(*)::int AS count
      FROM complaints
      GROUP BY COALESCE((metadata->>'severity')::int, 0)
      ORDER BY severity ASC
    `,
    pool`
      SELECT
        to_char(day_bucket, 'YYYY-MM-DD') AS date,
        COUNT(*)::int AS complaints,
        COUNT(*) FILTER (WHERE resolved_status = TRUE)::int AS resolved
      FROM (
        SELECT
          date_trunc('day', created_at) AS day_bucket,
          CASE WHEN status IN ('RESOLVED', 'Resolved') THEN TRUE ELSE FALSE END AS resolved_status
        FROM complaints
        WHERE created_at >= NOW() - INTERVAL '5 days'
      ) AS complaint_days
      GROUP BY day_bucket
      ORDER BY day_bucket ASC
    `,
    pool`
      SELECT
        COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600.0), 0)::float AS average_hours
      FROM complaints
      WHERE status IN ('RESOLVED', 'Resolved')
    `
  ]);

  const normalizedCounts = Object.entries(byStatus).reduce<Record<string, number>>((acc, [status, count]) => {
    const normalized = normalizeComplaintStatus(status);
    acc[normalized] = (acc[normalized] ?? 0) + count;
    return acc;
  }, {});

  const totalComplaints = Object.values(normalizedCounts).reduce((a, b) => a + b, 0);
  const openComplaints = (normalizedCounts.Open ?? 0) + (byStatus.FILED ?? 0);
  const inProgressComplaints = normalizedCounts.InProgress ?? 0;
  const resolvedComplaints = normalizedCounts.Resolved ?? 0;
  const slaBreaches = normalizedCounts.Escalated ?? 0;
  const averageResolutionTime = Number((Number(resolutionRows[0]?.average_hours ?? 0)).toFixed(1));

  res.json({
    totalComplaints,
    openComplaints,
    inProgressComplaints,
    resolvedComplaints,
    averageResolutionTime,
    slaBreaches,
    complaintsByType: typeRows.map((row: any) => ({ type: row.type, count: row.count })),
    complaintsBySeverity: severityRows.map((row: any) => ({ severity: Number(row.severity), count: row.count })),
    trendsData: trendRows.map((row: any) => ({ date: row.date, complaints: row.complaints, resolved: row.resolved })),
    byStatus,
    totals: { total: totalComplaints }
  });
});

// ---------------------------------------------------------------------------
// GET /budget
// ---------------------------------------------------------------------------
router.get('/budget', requireAuth, async (req, res) => {
  const budgetRows = await pool`
    SELECT status, COUNT(*)::int AS count 
    FROM complaints 
    WHERE UPPER(status) <> 'RESOLVED' 
    GROUP BY status
  `;

  const counts: Record<string, number> = {};
  for (const row of budgetRows) {
    counts[row.status] = row.count;
  }

  const pending = counts['FILED'] ?? 0;
  const inProgress = counts['IN_PROGRESS'] ?? 0;
  const rejected = counts['REJECTED'] ?? 0;
  const estimatedBacklogCostINR = pending * 25000 + inProgress * 10000 + rejected * 2000;

  res.json({
    district: null,
    estimatedBacklogCostINR,
    model: { PENDING: 25000, IN_PROGRESS: 10000, REJECTED: 2000 },
    counts
  });
});

// ---------------------------------------------------------------------------
// GET /audit
// ---------------------------------------------------------------------------
router.get('/audit', requireAuth, requireRole(['CE']), async (req, res) => {
  const auditLogs = await pool`
    SELECT id, actor_phone_masked, actor_phone_hash, action, target_type, target_id, details, created_at
    FROM audit_log
    ORDER BY created_at DESC
    LIMIT 200
  `;

  // Explicitly mapping keys backward to ensure compliance with old snake_case models
  const mappedLogs = auditLogs.map((r: any) => ({
    id: r.id,
    actor_phone_masked: r.actorPhoneMasked ?? r.actor_phone_masked,
    actor_phone_hash: r.actorPhoneHash ?? r.actor_phone_hash,
    action: r.action,
    target_type: r.targetType ?? r.target_type,
    target_id: r.targetId ?? r.target_id,
    details: r.details,
    fabric_txid: r.fabricTxid ?? null,
    created_at: r.createdAt ?? r.created_at
  }));

  res.json({ entries: mappedLogs });
});

// ---------------------------------------------------------------------------
// GET /performance/evaluation
// ---------------------------------------------------------------------------
router.get('/performance/evaluation', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const usersRes = await pool`
    SELECT
      u.id,
      u.role,
      u.phone_masked,
      COUNT(CASE WHEN al.action = 'COMPLAINT_ASSIGNED'  THEN 1 END)::int AS assigned,
      COUNT(CASE WHEN al.action = 'COMPLAINT_RESOLVED'  THEN 1 END)::int AS resolved,
      COUNT(CASE WHEN al.action = 'COMPLAINT_ESCALATED' THEN 1 END)::int AS escalated,
      COUNT(CASE WHEN al.action = 'SLA_WARNING'         THEN 1 END)::int AS sla_warnings
    FROM users u
    LEFT JOIN audit_log al ON al.actor_user_id = u.id
    WHERE u.role IN ('CE','EE')
    GROUP BY u.id, u.role, u.phone_masked
    LIMIT 200
  `;

  const employeesRanked = usersRes
    .map((r: any) => {
      const assigned = r.assigned;
      const resolved = r.resolved;
      const escalated = r.escalated;
      const slaWarnings = r.slaWarnings ?? r.sla_warnings;
      const phoneMasked = r.phoneMasked ?? r.phone_masked;

      const karma = resolved * 6 + assigned * 2 - escalated * 4 - slaWarnings * 3;
      return { userId: r.id, role: r.role, phoneMasked, assigned, resolved, escalated, slaWarnings, karma };
    })
    .sort((a: any, b: any) => b.karma - a.karma)
    .map((row: any, idx: number) => ({ ...row, rank: idx + 1 }));

  const contractors = await getContractorScorecard({ limit: 200 });
  const contractorRows = contractors
    .map((c) => {
      const onTime = c.onTimeRate == null ? 0 : c.onTimeRate * 100;
      const karma = c.resolvedCount * 5 + Math.round(onTime) - c.slaBreaches * 4 - c.openCount;
      return { contractorId: c.contractorId, contractorName: c.contractorName, assignedCount: c.assignedCount, resolvedCount: c.resolvedCount, openCount: c.openCount, slaBreaches: c.slaBreaches, onTimeRate: c.onTimeRate, avgResolutionDays: c.avgResolutionDays, karma };
    })
    .sort((a: any, b: any) => b.karma - a.karma)
    .map((row: any, idx: number) => ({ ...row, rank: idx + 1 }));

  res.json({ district: null, zone: null, employees: employeesRanked, contractors: contractorRows });
});

export default router;