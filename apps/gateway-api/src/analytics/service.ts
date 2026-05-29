import PDFDocument from 'pdfkit';
import { pool } from '../postgres.js';

// Anomaly engine tunables from environment (defaults kept conservative)
const ANOMALY_BUDGET_UPPER_MULTIPLIER = Number(process.env.ANOMALY_BUDGET_UPPER_MULTIPLIER ?? 1.15);
const ANOMALY_BUDGET_LOWER_MULTIPLIER = Number(process.env.ANOMALY_BUDGET_LOWER_MULTIPLIER ?? 0.9);
const ANOMALY_CONTRACTOR_UPPER_MULTIPLIER = Number(process.env.ANOMALY_CONTRACTOR_UPPER_MULTIPLIER ?? 1.2);
const ANOMALY_CONTRACTOR_LOWER_MULTIPLIER = Number(process.env.ANOMALY_CONTRACTOR_LOWER_MULTIPLIER ?? 0.85);
const ANOMALY_VENDOR_SPIKE_MULTIPLIER = Number(process.env.ANOMALY_VENDOR_SPIKE_MULTIPLIER ?? 10);
const ANOMALY_DAILY_THRESHOLD_MULTIPLIER = Number(process.env.ANOMALY_DAILY_THRESHOLD_MULTIPLIER ?? 0.25);
const ANOMALY_ZSCORE_THRESHOLD = Number(process.env.ANOMALY_ZSCORE_THRESHOLD ?? 3);
const ANOMALY_ROLLING_STD_MULT = Number(process.env.ANOMALY_ROLLING_STD_MULT ?? 3);

export type AnalyticsEventType =
  | 'COMPLAINT_CREATED'
  | 'COMPLAINT_STATUS_CHANGED'
  | 'COMPLAINT_ESCALATED'
  | 'COMPLAINT_RESOLVED'
  | 'COMPLAINT_ASSIGNED'
  | 'SLA_WARNING';

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

export async function trackAnalyticsEvent(event: {
  type: string; // allow broader event vocabulary across services
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
  for (const row of r.rows) {
    const normalized = normalizeComplaintStatus(row.status);
    byStatus[normalized] = (byStatus[normalized] ?? 0) + Number(row.count ?? 0);
  }
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

  const where: string[] = [`UPPER(status) <> 'RESOLVED'`, `created_at <= now() - ($1::int * interval '1 day')`];
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

    if (String(row.status ?? '').toUpperCase() !== 'RESOLVED') v.open += 1;

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
  karmaScore: number;
  reliabilityRank: number;
  avgSlaSuccessDays: number | null;
  repeatFailureRate: number;
  budgetDisciplineScore: number;
  citizenSatisfactionScore: number;
  auditPerformanceScore: number;
  maintenanceEfficiencyScore: number;
  historicalDurabilityDays: number;
  regionalExpertise: string[];
  roadTypeSpecialization: string[];
  riskIndicator: 'low' | 'medium' | 'high';
  lifecycleCostINR: number;
  proposalConfidence: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function safePercentage(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? Number.NaN)) return 0;
  return clamp(Number(value), 0, 100);
}

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
        ctr.districts AS contractor_districts,
        ctr.zones AS contractor_zones,
        count(*)::int AS assigned_count,
        count(*) FILTER (WHERE UPPER(c.status) = 'RESOLVED')::int AS resolved_count,
        count(*) FILTER (WHERE UPPER(c.status) <> 'RESOLVED')::int AS open_count,
        avg(EXTRACT(epoch FROM (c.updated_at - a.assigned_at))/86400.0) FILTER (WHERE UPPER(c.status) = 'RESOLVED') AS avg_resolution_days,
        count(*) FILTER (
          WHERE UPPER(c.status) = 'RESOLVED'
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

  const contractorIds = (r.rows as any[]).map((row) => String(row.contractor_id)).filter(Boolean);
  if (!contractorIds.length) return [];

  const [contractorInfoRes, roadTypeRes, complaintRoadRes, slaTrackingRes] = await Promise.all([
    pool.query(
      `SELECT id::text AS id, COALESCE(name, id::text) AS name, districts, zones
       FROM contractors
       WHERE id = ANY($1)`,
      [contractorIds]
    ),
    pool.query(
      `SELECT ra.contractor_id, COALESCE(rc.road_type, 'Unknown') AS road_type, count(*)::int AS count
       FROM road_assignments ra
       LEFT JOIN roads_catalog rc ON rc.id = ra.road_id
       WHERE ra.contractor_id = ANY($1)
       GROUP BY ra.contractor_id, COALESCE(rc.road_type, 'Unknown')`,
      [contractorIds]
    ),
    pool.query(
      `SELECT ca.contractor_id,
              c.road_id,
              count(*)::int AS complaint_count,
              count(*) FILTER (WHERE UPPER(c.status) = 'RESOLVED')::int AS resolved_count,
              avg(EXTRACT(epoch FROM (c.updated_at - ca.assigned_at))/86400.0) FILTER (WHERE UPPER(c.status) = 'RESOLVED') AS avg_resolution_days,
              count(*) FILTER (
                WHERE UPPER(c.status) = 'RESOLVED'
                  AND ca.expected_resolution_days IS NOT NULL
                  AND c.updated_at > ca.assigned_at + (ca.expected_resolution_days * interval '1 day')
              )::int AS breaches
       FROM complaint_assignments ca
       JOIN complaints c ON c.id = ca.complaint_id
       WHERE ca.contractor_id = ANY($1)
       GROUP BY ca.contractor_id, c.road_id`,
      [contractorIds]
    ),
    pool.query(
      `SELECT contractor_id,
              count(*)::int AS tracked_count,
              count(*) FILTER (WHERE breached)::int AS breach_count
       FROM sla_tracking
       WHERE contractor_id = ANY($1)
       GROUP BY contractor_id`,
      [contractorIds]
    )
  ]);

  const contractorInfoById = new Map<string, { districts: string[]; zones: string[] }>();
  for (const row of contractorInfoRes.rows as any[]) {
    contractorInfoById.set(String(row.id), {
      districts: normalizeList(row.districts),
      zones: normalizeList(row.zones)
    });
  }

  const roadTypesByContractor = new Map<string, Array<{ roadType: string; count: number }>>();
  for (const row of roadTypeRes.rows as any[]) {
    const contractorId = String(row.contractor_id);
    const entries = roadTypesByContractor.get(contractorId) ?? [];
    entries.push({ roadType: String(row.road_type ?? 'Unknown'), count: Number(row.count ?? 0) });
    roadTypesByContractor.set(contractorId, entries);
  }

  const complaintRoadStatsByContractor = new Map<string, Array<{ roadId: string; complaintCount: number; resolvedCount: number; avgResolutionDays: number | null; breaches: number }>>();
  for (const row of complaintRoadRes.rows as any[]) {
    const contractorId = String(row.contractor_id);
    const entries = complaintRoadStatsByContractor.get(contractorId) ?? [];
    entries.push({
      roadId: String(row.road_id),
      complaintCount: Number(row.complaint_count ?? 0),
      resolvedCount: Number(row.resolved_count ?? 0),
      avgResolutionDays: row.avg_resolution_days == null ? null : Number(row.avg_resolution_days),
      breaches: Number(row.breaches ?? 0)
    });
    complaintRoadStatsByContractor.set(contractorId, entries);
  }

  const slaStatsByContractor = new Map<string, { trackedCount: number; breachCount: number }>();
  for (const row of slaTrackingRes.rows as any[]) {
    slaStatsByContractor.set(String(row.contractor_id), {
      trackedCount: Number(row.tracked_count ?? 0),
      breachCount: Number(row.breach_count ?? 0)
    });
  }

  const rows = (r.rows as any[]).map((row) => {
    const contractorId = String(row.contractor_id);
    const resolved = Number(row.resolved_count ?? 0);
    const assigned = Number(row.assigned_count ?? 0);
    const openCount = Number(row.open_count ?? 0);
    const breaches = Number(row.sla_breaches ?? 0);
    const avgResolutionDays = row.avg_resolution_days == null ? null : Number(row.avg_resolution_days);
    const onTimeRate = resolved > 0 ? clamp((resolved - breaches) / resolved, 0, 1) : null;

    const contractorInfo = contractorInfoById.get(contractorId);
    const roadTypeEntries = (roadTypesByContractor.get(contractorId) ?? []).slice().sort((left, right) => right.count - left.count);
    const roadTypeSpecialization = roadTypeEntries.slice(0, 3).map((entry) => entry.roadType);

    const complaintRoadEntries = complaintRoadStatsByContractor.get(contractorId) ?? [];
    const repeatRoads = complaintRoadEntries.filter((entry) => entry.complaintCount > 1).length;
    const repeatFailureRate = complaintRoadEntries.length > 0 ? repeatRoads / complaintRoadEntries.length : 0;

    const trackedStats = slaStatsByContractor.get(contractorId);
    const trackedBreaches = trackedStats?.breachCount ?? breaches;
    const trackedTotal = trackedStats?.trackedCount ?? Math.max(assigned, 1);
    const trackedSuccessRate = trackedTotal > 0 ? clamp((trackedTotal - trackedBreaches) / trackedTotal, 0, 1) : 0;

    const budgetDisciplineScore = clamp(Math.round(100 - openCount * 2.2 - breaches * 5.5 - repeatFailureRate * 22 + trackedSuccessRate * 20), 0, 100);
    const citizenSatisfactionScore = clamp(Math.round(100 - openCount * 1.8 - breaches * 4.5 - repeatFailureRate * 18 + trackedSuccessRate * 15), 0, 100);
    const auditPerformanceScore = clamp(Math.round(100 - breaches * 7 - repeatFailureRate * 20 + trackedSuccessRate * 10), 0, 100);
    const maintenanceEfficiencyScore = clamp(Math.round(100 - repeatFailureRate * 28 - openCount * 1.5 - breaches * 3.5 + trackedSuccessRate * 15), 0, 100);
    const historicalDurabilityDays = Math.max(
      7,
      Math.round(clamp((avgResolutionDays ?? 14) * 1.6 + trackedSuccessRate * 25 - repeatFailureRate * 30 - breaches * 2, 7, 365))
    );
    const karmaScore = clamp(
      Math.round(62 + resolved * 1.45 + trackedSuccessRate * 20 + citizenSatisfactionScore * 0.12 - openCount * 2.1 - breaches * 8.5 - repeatFailureRate * 24),
      0,
      100
    );
    const proposalConfidence = clamp(Math.round(50 + trackedSuccessRate * 35 + citizenSatisfactionScore * 0.1 - repeatFailureRate * 20), 0, 100);
    const lifecycleCostINR = Math.round(assigned * 165000 + openCount * 75000 + breaches * 90000 + repeatRoads * 240000 + Math.max(0, 100 - karmaScore) * 2500);
    const riskIndicator: 'low' | 'medium' | 'high' =
      karmaScore < 55 || repeatFailureRate > 0.35 || breaches >= 4
        ? 'high'
        : karmaScore < 75 || repeatFailureRate > 0.15 || openCount >= 6
          ? 'medium'
          : 'low';

    const regionalExpertise = Array.from(new Set([...(contractorInfo?.districts ?? []), ...(contractorInfo?.zones ?? []), ...roadTypeSpecialization])).filter(Boolean);

    return {
      contractorId,
      contractorName: row.contractor_name,
      assignedCount: assigned,
      resolvedCount: resolved,
      openCount,
      avgResolutionDays,
      slaBreaches: breaches,
      onTimeRate,
      karmaScore,
      reliabilityRank: 0,
      avgSlaSuccessDays: avgResolutionDays,
      repeatFailureRate,
      budgetDisciplineScore,
      citizenSatisfactionScore,
      auditPerformanceScore,
      maintenanceEfficiencyScore,
      historicalDurabilityDays,
      regionalExpertise,
      roadTypeSpecialization,
      riskIndicator,
      lifecycleCostINR,
      proposalConfidence
    } satisfies ContractorScorecardRow;
  });

  return rows
    .sort((left, right) => {
      const karmaDelta = right.karmaScore - left.karmaScore;
      if (karmaDelta !== 0) return karmaDelta;

      const onTimeDelta = safePercentage(right.onTimeRate) - safePercentage(left.onTimeRate);
      if (onTimeDelta !== 0) return onTimeDelta;

      return right.resolvedCount - left.resolvedCount || left.slaBreaches - right.slaBreaches;
    })
    .map((row, index) => ({
      ...row,
      reliabilityRank: index + 1
    }));
}

export type ProposalIntelligence = {
  generatedAt: string;
  scope: { district: string | null; zone: string | null; roadType: string | null };
  plannedLengthKm: number;
  requestedBudgetINR: number | null;
  materialEstimateINR: number;
  laborEstimateINR: number;
  maintenanceReserveINR: number;
  lifecycleOwnershipCostINR: number;
  forecastRepairProbability: number;
  inflatedBudgetFlag: boolean;
  anomalyReason: string | null;
  anomaly?: {
    reasons: string[];
    severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
    deviationPercent?: number | null;
    signals: string[];
  } | null;
  contractorRecommendations: Array<{
    contractorId: string;
    contractorName: string;
    karmaScore: number;
    reliabilityRank: number;
    budgetDisciplineScore: number;
    durabilityScore: number;
    riskIndicator: 'low' | 'medium' | 'high';
    regionalExpertise: string[];
    roadTypeSpecialization: string[];
    estimatedLifecycleCostINR: number;
    proposalConfidence: number;
  }>;
};

function roadTypeMultiplier(roadType?: string | null): number {
  const normalized = String(roadType ?? '').trim().toLowerCase();
  if (!normalized) return 1;
  if (normalized.includes('nh') || normalized.includes('national')) return 1.45;
  if (normalized.includes('sh') || normalized.includes('state')) return 1.2;
  if (normalized.includes('mdr')) return 1.05;
  if (normalized.includes('urban') || normalized.includes('city')) return 1.1;
  if (normalized.includes('rural') || normalized.includes('village')) return 0.88;
  return 1;
}

export async function getProposalIntelligence(params?: {
  district?: string;
  zone?: string;
  roadType?: string;
  plannedLengthKm?: number;
  requestedBudgetINR?: number;
  limit?: number;
  // Optional anomaly-engine inputs
  materialPriceIndex?: number;
  laborCostIndex?: number;
  contractorQuotes?: number[];
  recentExpenses?: Array<{ date: string; amount: number; vendorId?: string; invoiceId?: string }>;
  dailySpendSeries?: number[]; // most recent last
  dailySpendThreshold?: number;
}): Promise<ProposalIntelligence> {
  const plannedLengthKm = Math.max(0.5, Number(params?.plannedLengthKm ?? 12));
  const requestedBudgetINR = typeof params?.requestedBudgetINR === 'number' && Number.isFinite(params.requestedBudgetINR)
    ? Math.max(0, Math.round(params.requestedBudgetINR))
    : null;
  const contractors = await getContractorScorecard({ district: params?.district, zone: params?.zone, limit: params?.limit ?? 12 });
  const multiplier = roadTypeMultiplier(params?.roadType);

  const materialEstimateINR = Math.round(plannedLengthKm * 3_000_000 * multiplier);
  const laborEstimateINR = Math.round(plannedLengthKm * 1_600_000 * multiplier);
  const averageRisk = contractors.length
    ? contractors.reduce((sum, row) => sum + (row.riskIndicator === 'high' ? 0.68 : row.riskIndicator === 'medium' ? 0.42 : 0.18), 0) / contractors.length
    : 0.32;
  const averageRepeatRate = contractors.length
    ? contractors.reduce((sum, row) => sum + row.repeatFailureRate, 0) / contractors.length
    : 0.15;
  const maintenanceReserveINR = Math.round((materialEstimateINR + laborEstimateINR) * (0.12 + averageRepeatRate * 0.28));
  const lifecycleOwnershipCostINR = materialEstimateINR + laborEstimateINR + maintenanceReserveINR;
  const forecastRepairProbability = clamp(Math.round((averageRisk * 0.55 + averageRepeatRate * 0.45) * 100), 0, 100);
  // Tighten anomaly thresholds: 15% upper bound, 10% lower bound
  const inflatedBudgetFlag = requestedBudgetINR != null ? requestedBudgetINR > lifecycleOwnershipCostINR * ANOMALY_BUDGET_UPPER_MULTIPLIER : false;

  // Compare against contractor-derived lifecycle estimates as an additional signal
  const contractorAvgLifecycleINR = contractors.length ? Math.round(contractors.reduce((s, c) => s + (c.lifecycleCostINR ?? 0), 0) / contractors.length) : lifecycleOwnershipCostINR;
  const deviationAboveContractors = requestedBudgetINR != null ? requestedBudgetINR > contractorAvgLifecycleINR * ANOMALY_CONTRACTOR_UPPER_MULTIPLIER : false;
  const deviationBelowContractors = requestedBudgetINR != null ? requestedBudgetINR < contractorAvgLifecycleINR * ANOMALY_CONTRACTOR_LOWER_MULTIPLIER : false;

  let anomalyReason: string | null = null;
  if (inflatedBudgetFlag || deviationAboveContractors) {
    const parts: string[] = [];
    if (inflatedBudgetFlag) parts.push('Requested budget exceeds lifecycle benchmark by more than 15%.');
    if (deviationAboveContractors) parts.push('Requested budget materially exceeds typical contractor estimates.');
    anomalyReason = parts.join(' ');
  } else if (requestedBudgetINR != null && (requestedBudgetINR < lifecycleOwnershipCostINR * 0.9 || deviationBelowContractors)) {
    const parts: string[] = [];
    if (requestedBudgetINR < lifecycleOwnershipCostINR * 0.9) parts.push('Requested budget appears materially below lifecycle benchmark.');
    if (deviationBelowContractors) parts.push('Requested budget is below typical contractor lifecycle estimates.');
    // If forecasted repair probability is high, lower-than-benchmark budgets are especially concerning
    if (forecastRepairProbability >= 70) parts.push('High forecast repair probability increases risk of under-budgeting.');
    anomalyReason = parts.join(' ');
  }

  // Layer-1 Rule Engine checks (deterministic)
  const signals: string[] = [];
  const reasons: string[] = [];

  if (Array.isArray(params?.recentExpenses) && params!.recentExpenses.length) {
    const expenses = params!.recentExpenses.filter((e) => Number.isFinite(e.amount) && e.amount > 0);
    // duplicate invoice
    const invoiceCounts = new Map<string, number>();
    for (const e of expenses) if (e.invoiceId) invoiceCounts.set(e.invoiceId, (invoiceCounts.get(e.invoiceId) ?? 0) + 1);
    for (const [inv, c] of invoiceCounts.entries()) if (c > 1) { signals.push('duplicate_invoice'); reasons.push(`Invoice ${inv} appears ${c} times.`); }

    // single large expense relative to lifecycle
    for (const e of expenses) {
      if (e.amount > lifecycleOwnershipCostINR * 0.9) {
        signals.push('single_large_expense');
        reasons.push(`Expense ${e.amount} exceeds 90% of lifecycle benchmark.`);
        break;
      }
    }

    // daily spend threshold
    const byDay = new Map<string, number>();
    for (const e of expenses) {
      const day = (new Date(e.date)).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + e.amount);
    }
    const dailyThreshold = Number.isFinite(params?.dailySpendThreshold ?? NaN) ? params!.dailySpendThreshold! : Math.max(1, Math.round(lifecycleOwnershipCostINR * ANOMALY_DAILY_THRESHOLD_MULTIPLIER));
    for (const [day, total] of byDay.entries()) if (total > dailyThreshold) { signals.push('daily_spend_threshold_exceeded'); reasons.push(`Daily spend ${total} on ${day} exceeds threshold ${dailyThreshold}.`); break; }

    // vendor sudden spike (10x)
    const vendorAmounts = new Map<string, number[]>();
    for (const e of expenses) {
      const v = String(e.vendorId ?? '');
      const arr = vendorAmounts.get(v) ?? [];
      arr.push(e.amount);
      vendorAmounts.set(v, arr);
    }
    for (const [v, arr] of vendorAmounts.entries()) {
      if (arr.length < 2) continue;
      const last = arr[arr.length - 1] ?? 0;
      const prevAvg = arr.slice(0, arr.length - 1).reduce((s, a) => s + a, 0) / Math.max(1, arr.length - 1);
      if (prevAvg > 0 && last > prevAvg * ANOMALY_VENDOR_SPIKE_MULTIPLIER) {
        signals.push('vendor_spike');
        reasons.push(`Vendor ${v} latest amount ${last} is >${ANOMALY_VENDOR_SPIKE_MULTIPLIER}x previous average ${Math.round(prevAvg)}.`);
      }
    }
  }

  // Layer-2 Statistical Detection (Z-score / rolling mean)
  if (Array.isArray(params?.dailySpendSeries) && params!.dailySpendSeries.length >= 7) {
    const series = params!.dailySpendSeries.map((n) => Number(n) || 0);
    const last = series[series.length - 1] ?? 0;
    const rest = series.slice(0, series.length - 1);
    const mean = rest.reduce((s, v) => s + v, 0) / Math.max(1, rest.length);
    const variance = rest.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / Math.max(1, rest.length);
    const std = Math.sqrt(variance);
    const z = std > 0 ? (last - mean) / std : 0;
    if (Math.abs(z) > ANOMALY_ZSCORE_THRESHOLD) { signals.push('zscore_outlier'); reasons.push(`Last daily spend has z=${z.toFixed(2)} (>${ANOMALY_ZSCORE_THRESHOLD}).`); }
    if (last > mean + ANOMALY_ROLLING_STD_MULT * std) { signals.push('rolling_mean_threshold'); reasons.push(`Last daily spend ${last} > rolling_mean + ${ANOMALY_ROLLING_STD_MULT}*std (${Math.round(mean + ANOMALY_ROLLING_STD_MULT * std)}).`); }
  }

  // compute deviation percent vs lifecycle
  const deviationPercent = requestedBudgetINR != null ? Math.round(((requestedBudgetINR - lifecycleOwnershipCostINR) / Math.max(1, lifecycleOwnershipCostINR)) * 100) : null;

  // severity mapping -> build anomaly object
  const uniqueSignals = Array.from(new Set(signals));
  let anomalyObj: ProposalIntelligence['anomaly'] = null;
  if (uniqueSignals.length === 0) {
    anomalyObj = { reasons: [], severity: 'none', deviationPercent, signals: [] };
  } else {
    const count = uniqueSignals.length;
    const sev: 'low' | 'medium' | 'high' | 'critical' = count === 1 ? 'low' : count === 2 ? 'medium' : count === 3 ? 'high' : 'critical';
    anomalyObj = { reasons, severity: sev, deviationPercent, signals: uniqueSignals };
  }

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      district: params?.district ?? null,
      zone: params?.zone ?? null,
      roadType: params?.roadType ?? null
    },
    plannedLengthKm,
    requestedBudgetINR,
    materialEstimateINR,
    laborEstimateINR,
    maintenanceReserveINR,
    lifecycleOwnershipCostINR,
    forecastRepairProbability,
    inflatedBudgetFlag,
    anomalyReason,
    anomaly: anomalyObj,
    contractorRecommendations: contractors.slice(0, 8).map((row) => ({
      contractorId: row.contractorId,
      contractorName: row.contractorName,
      karmaScore: row.karmaScore,
      reliabilityRank: row.reliabilityRank,
      budgetDisciplineScore: row.budgetDisciplineScore,
      durabilityScore: row.historicalDurabilityDays,
      riskIndicator: row.riskIndicator,
      regionalExpertise: row.regionalExpertise,
      roadTypeSpecialization: row.roadTypeSpecialization,
      estimatedLifecycleCostINR: row.lifecycleCostINR,
      proposalConfidence: row.proposalConfidence
    }))
  };
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
    where.push(`UPPER(status) <> 'RESOLVED'`);
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
