import PDFDocument from 'pdfkit';
import { pool } from '../db.js';

export type AnalyticsEventType =
  | 'COMPLAINT_CREATED'
  | 'COMPLAINT_STATUS_CHANGED'
  | 'COMPLAINT_ESCALATED'
  | 'COMPLAINT_RESOLVED'
  | 'COMPLAINT_ASSIGNED'
  | 'SLA_WARNING';

export async function trackAnalyticsEvent(event: {
  type: AnalyticsEventType;
  actorUserId?: string | null;
  complaintId?: string | null;
  contractorId?: string | null;
  district?: string | null;
  zone?: string | null;
  lat?: number | null;
  lng?: number | null;
  occurredAt?: Date;
  properties?: unknown;
}): Promise<void> {
  await pool.query(
    `INSERT INTO analytics_events (type, actor_user_id, complaint_id, contractor_id, district, zone, lat, lng, occurred_at, properties)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), COALESCE($10::jsonb, '{}'::jsonb));`,
    [
      event.type,
      event.actorUserId ?? null,
      event.complaintId ?? null,
      event.contractorId ?? null,
      event.district ?? null,
      event.zone ?? null,
      typeof event.lat === 'number' ? event.lat : null,
      typeof event.lng === 'number' ? event.lng : null,
      event.occurredAt ?? null,
      event.properties ? JSON.stringify(event.properties) : null
    ]
  );
}

export async function getCountsByStatus(params?: { district?: string; zone?: string }): Promise<Record<string, number>> {
  const where: string[] = [];
  const values: any[] = [];

  if (params?.district) {
    values.push(params.district);
    where.push(`district = $${values.length}`);
  }
  if (params?.zone) {
    values.push(params.zone);
    where.push(`zone = $${values.length}`);
  }

  const r = await pool.query(
    `SELECT status, count(*)::int AS count
     FROM complaints
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY status;`,
    values
  );

  const byStatus: Record<string, number> = {};
  for (const row of r.rows) byStatus[row.status] = row.count;
  return byStatus;
}

export type ChronicRoadItem = {
  complaintId: string;
  district: string;
  zone: string;
  status: string;
  description: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  ageDays: number;
};

export async function listChronicRoads(params?: {
  days?: number;
  limit?: number;
  district?: string;
  zone?: string;
}): Promise<ChronicRoadItem[]> {
  const days = Math.max(1, Math.floor(params?.days ?? 60));
  const limit = Math.min(500, Math.max(1, Math.floor(params?.limit ?? 100)));

  const where: string[] = [`status <> 'RESOLVED'`, `created_at <= now() - ($1::int * interval '1 day')`];
  const values: any[] = [days];

  if (params?.district) {
    values.push(params.district);
    where.push(`district = $${values.length}`);
  }
  if (params?.zone) {
    values.push(params.zone);
    where.push(`zone = $${values.length}`);
  }

  values.push(limit);

  const r = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, created_at,
            EXTRACT(epoch FROM (now() - created_at))/86400.0 AS age_days
     FROM complaints
     WHERE ${where.join(' AND ')}
     ORDER BY created_at ASC
     LIMIT $${values.length};`,
    values
  );

  return r.rows.map((row: any) => ({
    complaintId: row.id,
    district: row.district,
    zone: row.zone,
    status: row.status,
    description: row.description,
    lat: row.lat,
    lng: row.lng,
    createdAt: new Date(row.created_at).toISOString(),
    ageDays: Math.floor(Number(row.age_days ?? 0))
  }));
}

function cellSizeDegrees(cellKm: number): number {
  // Approx: 1 degree latitude ~ 111km.
  const km = Math.min(50, Math.max(0.2, cellKm));
  return km / 111;
}

function gridKey(lat: number, lng: number, cellKm: number): string {
  const d = cellSizeDegrees(cellKm);
  const latBucket = Math.floor(lat / d);
  const lngBucket = Math.floor(lng / d);
  return `${latBucket}:${lngBucket}`;
}

export type HotspotCluster = {
  key: string;
  count: number;
  centroid: { lat: number; lng: number };
  districts: string[];
  zones: string[];
  complaintIds: string[];
};

export async function getHotspots(params?: {
  days?: number;
  cellKm?: number;
  limit?: number;
  district?: string;
  zone?: string;
}): Promise<HotspotCluster[]> {
  const days = Math.max(1, Math.floor(params?.days ?? 30));
  const cellKm = params?.cellKm ?? 1;
  const limit = Math.min(200, Math.max(1, Math.floor(params?.limit ?? 20)));

  const where: string[] = [`lat IS NOT NULL`, `lng IS NOT NULL`, `created_at >= now() - ($1::int * interval '1 day')`];
  const values: any[] = [days];

  if (params?.district) {
    values.push(params.district);
    where.push(`district = $${values.length}`);
  }
  if (params?.zone) {
    values.push(params.zone);
    where.push(`zone = $${values.length}`);
  }

  const r = await pool.query(
    `SELECT id, district, zone, lat, lng
     FROM complaints
     WHERE ${where.join(' AND ')}
     LIMIT 5000;`,
    values
  );

  const clusters = new Map<
    string,
    {
      count: number;
      sumLat: number;
      sumLng: number;
      districts: Set<string>;
      zones: Set<string>;
      complaintIds: string[];
    }
  >();

  for (const row of r.rows as any[]) {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const key = gridKey(lat, lng, cellKm);
    const existing = clusters.get(key) ?? {
      count: 0,
      sumLat: 0,
      sumLng: 0,
      districts: new Set<string>(),
      zones: new Set<string>(),
      complaintIds: [] as string[]
    };

    existing.count += 1;
    existing.sumLat += lat;
    existing.sumLng += lng;
    existing.districts.add(row.district);
    existing.zones.add(row.zone);
    existing.complaintIds.push(row.id);

    clusters.set(key, existing);
  }

  return [...clusters.entries()]
    .map(([key, v]) => ({
      key,
      count: v.count,
      centroid: { lat: v.sumLat / v.count, lng: v.sumLng / v.count },
      districts: [...v.districts.values()],
      zones: [...v.zones.values()],
      complaintIds: v.complaintIds.slice(0, 50)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export type WorseningTrend = {
  key: string;
  recentCount: number;
  previousCount: number;
  openCount: number;
  score: number;
  centroid: { lat: number; lng: number } | null;
};

export async function getWorseningTrends(params?: {
  days?: number;
  cellKm?: number;
  limit?: number;
  district?: string;
  zone?: string;
  minRecent?: number;
}): Promise<WorseningTrend[]> {
  const windowDays = Math.max(7, Math.floor(params?.days ?? 56));
  const half = Math.floor(windowDays / 2);
  const cellKm = params?.cellKm ?? 1;
  const limit = Math.min(200, Math.max(1, Math.floor(params?.limit ?? 20)));
  const minRecent = Math.max(1, Math.floor(params?.minRecent ?? 2));

  const where: string[] = [`lat IS NOT NULL`, `lng IS NOT NULL`, `created_at >= now() - ($1::int * interval '1 day')`];
  const values: any[] = [windowDays];

  if (params?.district) {
    values.push(params.district);
    where.push(`district = $${values.length}`);
  }
  if (params?.zone) {
    values.push(params.zone);
    where.push(`zone = $${values.length}`);
  }

  const r = await pool.query(
    `SELECT id, status, created_at, lat, lng
     FROM complaints
     WHERE ${where.join(' AND ')}
     LIMIT 10000;`,
    values
  );

  const nowMs = Date.now();
  const recentStart = nowMs - half * 86400_000;
  const previousStart = nowMs - 2 * half * 86400_000;

  const byKey = new Map<
    string,
    {
      recent: number;
      previous: number;
      open: number;
      sumLat: number;
      sumLng: number;
      points: number;
    }
  >();

  for (const row of r.rows as any[]) {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const key = gridKey(lat, lng, cellKm);
    const v = byKey.get(key) ?? { recent: 0, previous: 0, open: 0, sumLat: 0, sumLng: 0, points: 0 };

    const createdMs = new Date(row.created_at).getTime();
    if (createdMs >= recentStart) v.recent += 1;
    else if (createdMs >= previousStart) v.previous += 1;

    if (row.status !== 'RESOLVED') v.open += 1;

    v.sumLat += lat;
    v.sumLng += lng;
    v.points += 1;

    byKey.set(key, v);
  }

  const trends: WorseningTrend[] = [];
  for (const [key, v] of byKey.entries()) {
    if (v.recent < minRecent) continue;
    const delta = v.recent - v.previous;
    const score = delta + v.open * 0.25;
    if (score <= 0) continue;

    trends.push({
      key,
      recentCount: v.recent,
      previousCount: v.previous,
      openCount: v.open,
      score,
      centroid: v.points ? { lat: v.sumLat / v.points, lng: v.sumLng / v.points } : null
    });
  }

  return trends.sort((a, b) => b.score - a.score).slice(0, limit);
}

export type ContractorScorecardRow = {
  contractorId: string;
  contractorName: string;
  assignedCount: number;
  resolvedCount: number;
  openCount: number;
  avgResolutionDays: number | null;
  slaBreaches: number;
  onTimeRate: number | null;
};

export async function getContractorScorecard(params?: { district?: string; zone?: string; limit?: number }): Promise<ContractorScorecardRow[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(params?.limit ?? 50)));
  const where: string[] = [];
  const values: any[] = [];

  if (params?.district) {
    values.push(params.district);
    where.push(`c.district = $${values.length}`);
  }
  if (params?.zone) {
    values.push(params.zone);
    where.push(`c.zone = $${values.length}`);
  }

  values.push(limit);

  const r = await pool.query(
    `SELECT
        ctr.id AS contractor_id,
        ctr.name AS contractor_name,
        count(*)::int AS assigned_count,
        count(*) FILTER (WHERE c.status = 'RESOLVED')::int AS resolved_count,
        count(*) FILTER (WHERE c.status <> 'RESOLVED')::int AS open_count,
        avg(EXTRACT(epoch FROM (c.updated_at - a.assigned_at))/86400.0) FILTER (WHERE c.status = 'RESOLVED') AS avg_resolution_days,
        count(*) FILTER (
          WHERE c.status = 'RESOLVED'
            AND a.expected_resolution_days IS NOT NULL
            AND c.updated_at > a.assigned_at + (a.expected_resolution_days * interval '1 day')
        )::int AS sla_breaches
     FROM complaint_assignments a
     JOIN contractors ctr ON ctr.id = a.contractor_id
     JOIN complaints c ON c.id = a.complaint_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY ctr.id, ctr.name
     ORDER BY resolved_count DESC, assigned_count DESC
     LIMIT $${values.length};`,
    values
  );

  return (r.rows as any[]).map((row) => {
    const resolved = Number(row.resolved_count ?? 0);
    const breaches = Number(row.sla_breaches ?? 0);
    return {
      contractorId: row.contractor_id,
      contractorName: row.contractor_name,
      assignedCount: Number(row.assigned_count ?? 0),
      resolvedCount: resolved,
      openCount: Number(row.open_count ?? 0),
      avgResolutionDays: row.avg_resolution_days == null ? null : Number(row.avg_resolution_days),
      slaBreaches: breaches,
      onTimeRate: resolved > 0 ? (resolved - breaches) / resolved : null
    } satisfies ContractorScorecardRow;
  });
}

export function toCsv(rows: Record<string, any>[], columns: string[]): string {
  const escape = (value: any) => {
    const s = value == null ? '' : String(value);
    if (/[\r\n,\"]/g.test(s)) return `"${s.replace(/\"/g, '""')}"`;
    return s;
  };

  const header = columns.map(escape).join(',');
  const lines = rows.map((row) => columns.map((c) => escape(row[c])).join(','));
  return [header, ...lines].join('\n') + '\n';
}

export async function exportRoadsGeoJson(params?: {
  chronicOnly?: boolean;
  chronicDays?: number;
  district?: string;
  zone?: string;
  limit?: number;
}): Promise<any> {
  const limit = Math.min(20000, Math.max(1, Math.floor(params?.limit ?? 5000)));

  const where: string[] = [`lat IS NOT NULL`, `lng IS NOT NULL`];
  const values: any[] = [];

  if (params?.chronicOnly) {
    const days = Math.max(1, Math.floor(params?.chronicDays ?? 60));
    values.push(days);
    where.push(`status <> 'RESOLVED'`);
    where.push(`created_at <= now() - ($${values.length}::int * interval '1 day')`);
  }

  if (params?.district) {
    values.push(params.district);
    where.push(`district = $${values.length}`);
  }
  if (params?.zone) {
    values.push(params.zone);
    where.push(`zone = $${values.length}`);
  }

  values.push(limit);

  const r = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, created_at, updated_at
     FROM complaints
     WHERE ${where.join(' AND ')}
     ORDER BY updated_at DESC
     LIMIT $${values.length};`,
    values
  );

  return {
    type: 'FeatureCollection',
    features: (r.rows as any[]).map((row) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [Number(row.lng), Number(row.lat)]
      },
      properties: {
        id: row.id,
        district: row.district,
        zone: row.zone,
        status: row.status,
        description: row.description,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      }
    }))
  };
}

export async function renderPublicRoadsPdf(params: {
  title: string;
  byStatus: Record<string, number>;
  chronic: ChronicRoadItem[];
  contractors: ContractorScorecardRow[];
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];

  doc.on('data', (c) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(18).text(params.title, { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#666666').text(`Generated: ${new Date().toISOString()}`);
  doc.fillColor('#000000');

  doc.moveDown(1);
  doc.fontSize(13).text('City-wide Road Health (from complaints)', { underline: true });
  doc.moveDown(0.5);

  const statuses = Object.entries(params.byStatus).sort((a, b) => b[1] - a[1]);
  for (const [status, count] of statuses) {
    doc.fontSize(11).text(`${status}: ${count}`);
  }

  doc.moveDown(1);
  doc.fontSize(13).text('Chronic Roads (60+ days unresolved)', { underline: true });
  doc.moveDown(0.5);
  if (!params.chronic.length) {
    doc.fontSize(11).text('No chronic roads in this view.');
  } else {
    for (const item of params.chronic.slice(0, 25)) {
      doc.fontSize(10).text(`${item.complaintId} — ${item.district}/${item.zone} — ${item.ageDays} days — ${item.status}`);
      doc.fontSize(9).fillColor('#444444').text(item.description, { indent: 12 });
      doc.fillColor('#000000');
      doc.moveDown(0.2);
    }
  }

  doc.moveDown(1);
  doc.fontSize(13).text('Contractor Public Scorecard', { underline: true });
  doc.moveDown(0.5);
  if (!params.contractors.length) {
    doc.fontSize(11).text('No contractor assignment data available.');
  } else {
    for (const c of params.contractors.slice(0, 20)) {
      const onTime = c.onTimeRate == null ? '—' : `${Math.round(c.onTimeRate * 100)}%`;
      const avg = c.avgResolutionDays == null ? '—' : `${c.avgResolutionDays.toFixed(1)}d`;
      doc
        .fontSize(10)
        .text(
          `${c.contractorName} (${c.contractorId}) — assigned ${c.assignedCount}, resolved ${c.resolvedCount}, open ${c.openCount}, avg ${avg}, on-time ${onTime}`
        );
    }
  }

  doc.end();
  return done;
}
