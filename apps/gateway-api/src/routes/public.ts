import express from 'express';
import { z } from 'zod';
import {
    exportRoadsGeoJson,
    getContractorScorecard,
    getCountsByStatus,
    getHotspots,
    getProposalIntelligence,
    getWorseningTrends,
    listChronicRoads,
    renderPublicRoadsPdf,
    toCsv
} from '../analytics/service.js';
  import { analyzeComplaintText, summarizeRoadTextIntel } from '../../../../packages/core/src/engines/complaintTextIntel.ts';
import {
    getDistrictOfflineManifest,
    listCountries,
    listDistricts,
    listRoadsForDistrict,
    listStates
} from '../db.js';
import { pool } from '../postgres.js';

const router = express.Router();

router.get('/countries', async (_req, res) => {
  const countries = await listCountries();
  res.json({ countries });
});

router.get('/states', async (req, res) => {
  const q = z.object({ country: z.string().min(2) }).parse(req.query);
  const states = await listStates(q.country);
  res.json({ states });
});

router.get('/districts', async (req, res) => {
  const q = z
    .object({ country: z.string().min(2), state: z.string().min(1) })
    .parse(req.query);
  const districts = await listDistricts(q.country, q.state);
  res.json({ districts });
});

router.get('/districts/:districtId/offline-manifest', async (req, res) => {
  const districtId = z.string().uuid().parse(req.params.districtId);
  const manifest = await getDistrictOfflineManifest(districtId);
  if (!manifest) return res.status(404).json({ error: 'District not found' });

  res.json({
    manifest: {
      ...manifest,
      // relative endpoints for the client
      roadsUrl: `/public/districts/${districtId}/roads`
    }
  });
});

router.get('/districts/:districtId/roads', async (req, res) => {
  const districtId = z.string().uuid().parse(req.params.districtId);
  const roads = await listRoadsForDistrict(districtId);

  // For fresh local DBs there may be no roads; return empty list.
  res.json({ roads });
});

// Road segments (GeoJSON) for map overlays.
// Query by districtId OR by a point (lat/lng) which is resolved to a district via bbox.
router.get('/roads/segments.geojson', async (req, res) => {
  const query = z
    .object({
      districtId: z.string().uuid().optional(),
      lat: z.coerce.number().optional(),
      lng: z.coerce.number().optional(),
      limit: z.coerce.number().int().positive().optional().default(5000)
    })
    .parse(req.query);

  let districtId = query.districtId;
  if (!districtId) {
    if (typeof query.lat !== 'number' || typeof query.lng !== 'number') {
      return res.status(400).json({ error: 'Provide districtId or lat/lng' });
    }

    // Resolve lat/lng to district via bbox query in PostgreSQL
    const result = await pool.query(
      `SELECT id FROM districts
       WHERE top_left_lat >= $1 AND bottom_right_lat <= $1
       AND top_left_lng <= $2 AND bottom_right_lng >= $2
       LIMIT 1`,
      [query.lat, query.lng]
    );
    districtId = result.rows[0]?.id;
    if (!districtId) return res.json({ type: 'FeatureCollection', features: [] });
  }

  const limit = Math.min(20000, Math.max(1, query.limit));
  const roadsRes = await pool.query(
    `SELECT id, name, road_type, authority_id, geometry FROM roads_catalog
     WHERE district_id = $1 AND geometry IS NOT NULL
     LIMIT $2`,
    [districtId, limit]
  );

  const roadIds = roadsRes.rows.map((r: any) => r.id);
  const roadTextIntelByRoadId = new Map<string, ReturnType<typeof summarizeRoadTextIntel>>();

  if (roadIds.length > 0) {
    const complaintIntelRes = await pool.query(
      `SELECT road_id, description, report_count
       FROM complaints
       WHERE road_id = ANY($1)`,
      [roadIds]
    );

    const samplesByRoadId = new Map<string, Array<ReturnType<typeof analyzeComplaintText> & { reportCount?: number }>>();
    for (const row of complaintIntelRes.rows as any[]) {
      const roadId = String(row.road_id);
      const entries = samplesByRoadId.get(roadId) ?? [];
      entries.push({
        ...analyzeComplaintText(row.description ?? null),
        reportCount: Number(row.report_count ?? 1)
      });
      samplesByRoadId.set(roadId, entries);
    }

    for (const [roadId, samples] of samplesByRoadId.entries()) {
      roadTextIntelByRoadId.set(roadId, summarizeRoadTextIntel(samples));
    }
  }

  // Prefetch all authority info for these roads
  const authorityIds = Array.from(new Set(roadsRes.rows.map((r: any) => r.authority_id).filter(Boolean)));
  const authorities: Record<string, any> = {};
  
  if (authorityIds.length > 0) {
    const authRes = await pool.query(
      `SELECT authority_id, name, department, public_phone, public_email, website, address
       FROM authority_directory
       WHERE authority_id = ANY($1)`,
      [authorityIds]
    );
    for (const row of authRes.rows) {
    }
  }

  // Prefetch all road assignments
  const roadIds = roadsRes.rows.map((r: any) => r.id);
  const assignmentsRes = await pool.query(
    `SELECT road_id, contractor_id, engineer_user_id, starts_on, ends_on, assigned_at
     FROM road_assignments
     WHERE road_id = ANY($1)
     ORDER BY assigned_at DESC NULLS LAST`,
    [roadIds]
  );

  // Group assignments by road_id and take the latest
  const latestAssignments: Record<string, any> = {};
  for (const row of assignmentsRes.rows) {
    if (!latestAssignments[row.road_id]) {
      latestAssignments[row.road_id] = row;
    }
  }

  // Prefetch contractor and engineer info
  const contractorIds = Object.values(latestAssignments)
    .map((a: any) => a.contractor_id)
    .filter(Boolean);
  const engineerIds = Object.values(latestAssignments)
    .map((a: any) => a.engineer_user_id)
    .filter(Boolean);

  const contractors: Record<string, any> = {};
  if (contractorIds.length > 0) {
    const cRes = await pool.query(
      `SELECT id, name, contact_phone_masked FROM contractors WHERE id = ANY($1)`,
      [contractorIds]
    );
    for (const row of cRes.rows) {
      contractors[row.id] = row;
    }
  }

  const engineers: Record<string, any> = {};
  if (engineerIds.length > 0) {
    const eRes = await pool.query(
      `SELECT id, govt_id FROM users WHERE id = ANY($1)`,
      [engineerIds]
    );
    for (const row of eRes.rows) {
      engineers[row.id] = row;
    }
  }

  const features = [];
  for (const row of roadsRes.rows) {
    const assignment = latestAssignments[row.id];
    const contractor = assignment?.contractor_id ? contractors[assignment.contractor_id] : null;
    const engineer = assignment?.engineer_user_id ? engineers[assignment.engineer_user_id] : null;
    const authority = authorities[row.authority_id] ?? null;
    const complaintIntel = roadTextIntelByRoadId.get(row.id) ?? {
      totalReportCount: 0,
      analyzedCount: 0,
      negativeReportCount: 0,
      urgentReportCount: 0,
      averageSentimentScore: 0,
      priorityFlag: false,
      priorityScore: 0,
      languages: [],
      signals: []
    };

    features.push({
      type: 'Feature',
      geometry: row.geometry,
      properties: {
        roadId: row.id,
        name: row.name,
        roadType: row.road_type,
        authorityId: row.authority_id,
        districtCode: null,
        assignment: {
          contractorId: assignment?.contractor_id ?? null,
          contractorName: contractor?.name ?? null,
          contractorPhoneMasked: contractor?.contact_phone_masked ?? null,
          engineerUserId: assignment?.engineer_user_id ?? null,
          engineerGovtId: engineer?.govt_id ?? null,
          startsOn: assignment?.starts_on ? new Date(assignment.starts_on).toISOString().slice(0, 10) : null,
          endsOn: assignment?.ends_on ? new Date(assignment.ends_on).toISOString().slice(0, 10) : null
        },
        authority: {
          name: authority?.name ?? null,
          department: authority?.department ?? null,
          publicPhone: authority?.public_phone ?? null,
          publicEmail: authority?.public_email ?? null,
          website: authority?.website ?? null,
          address: authority?.address ?? null
        },
        complaintIntel: {
          totalReportCount: complaintIntel.totalReportCount,
          analyzedCount: complaintIntel.analyzedCount,
          negativeReportCount: complaintIntel.negativeReportCount,
          urgentReportCount: complaintIntel.urgentReportCount,
          averageSentimentScore: complaintIntel.averageSentimentScore,
          priorityFlag: complaintIntel.priorityFlag,
          priorityScore: complaintIntel.priorityScore,
          languages: complaintIntel.languages,
          signals: complaintIntel.signals
        }
      }
    });
  }

  res.setHeader('Content-Type', 'application/geo+json');
  res.json({
    type: 'FeatureCollection',
    features
  });
});

router.get('/authorities/:authorityId', async (req, res) => {
  const params = z.object({ authorityId: z.string().min(1) }).parse(req.params);
  const result = await pool.query(
    `SELECT authority_id, name, department, public_phone, public_email, website, address, updated_at
     FROM authority_directory
     WHERE authority_id = $1
     LIMIT 1`,
    [params.authorityId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ authority: result.rows[0] });
});

// ---------------------------------------------------------------------------
// Public dashboard (no login)
// ---------------------------------------------------------------------------

router.get('/dashboard', async (req, res) => {
  const query = z
    .object({
      district: z.string().min(1).optional(),
      zone: z.string().min(1).optional(),
      chronicDays: z.coerce.number().int().positive().optional().default(60)
    })
    .parse(req.query);

  const byStatus = await getCountsByStatus({ district: query.district, zone: query.zone });
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const unresolved = total - (byStatus['RESOLVED'] ?? 0);
  const roadHealthIndex = total === 0 ? 100 : Math.max(0, Math.min(100, Math.round(100 - (unresolved / total) * 100)));

  const chronic = await listChronicRoads({ days: query.chronicDays, limit: 50, district: query.district, zone: query.zone });
  const hotspots = await getHotspots({ days: 30, cellKm: 1, limit: 20, district: query.district, zone: query.zone });
  const trends = await getWorseningTrends({ days: 56, cellKm: 1, limit: 20, district: query.district, zone: query.zone });
  const contractors = await getContractorScorecard({ district: query.district, zone: query.zone, limit: 50 });

  res.json({
    generatedAt: new Date().toISOString(),
    scope: { district: query.district ?? null, zone: query.zone ?? null },
    roadHealthIndex,
    totals: { total },
    byStatus,
    chronic: {
      rule: `Unresolved complaints become public after ${query.chronicDays} days`,
      chronicDays: query.chronicDays,
      items: chronic
    },
    hotspots,
    trends,
    contractorScorecard: contractors
  });
});

router.get('/chronic-roads', async (req, res) => {
  const query = z
    .object({
      days: z.coerce.number().int().positive().optional().default(60),
      limit: z.coerce.number().int().positive().optional().default(100),
      district: z.string().min(1).optional(),
      zone: z.string().min(1).optional()
    })
    .parse(req.query);

  const items = await listChronicRoads(query);
  res.json({ days: query.days, items });
});

router.get('/contractors/scorecard', async (req, res) => {
  const query = z
    .object({
      district: z.string().min(1).optional(),
      zone: z.string().min(1).optional(),
      limit: z.coerce.number().int().positive().optional().default(50)
    })
    .parse(req.query);

  const rows = await getContractorScorecard(query);
  res.json({ generatedAt: new Date().toISOString(), rows });
});

router.get('/proposals/intelligence', async (req, res) => {
  const query = z
    .object({
      district: z.string().min(1).optional(),
      zone: z.string().min(1).optional(),
      roadType: z.string().min(1).optional(),
      plannedLengthKm: z.coerce.number().positive().optional().default(12),
      requestedBudgetINR: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().optional().default(12)
    })
    .parse(req.query);

  const lookbackDays = Math.max(1, Math.floor(Number(process.env.ANOMALY_LOOKBACK_DAYS ?? 30)));
  const expenditureResult = await pool.query(
    `SELECT id, allocation_id, amount, description, contractor_id, "timestamp", district, zone
     FROM budget_expenditures
     WHERE "timestamp" >= now() - ($1::int * interval '1 day')
       ${query.district ? 'AND district = $2' : ''}
       ${query.zone ? (query.district ? 'AND zone = $3' : 'AND zone = $2') : ''}
     ORDER BY "timestamp" DESC
     LIMIT 500`,
    query.district && query.zone ? [lookbackDays, query.district, query.zone] : query.district ? [lookbackDays, query.district] : query.zone ? [lookbackDays, query.zone] : [lookbackDays]
  );

  const recentExpenses = expenditureResult.rows.map((row: any) => ({
    date: new Date(row.timestamp).toISOString(),
    amount: Number(row.amount ?? 0),
    vendorId: row.contractor_id ?? null
  }));

  const dayMap = new Map<string, number>();
  for (const row of expenditureResult.rows as any[]) {
    const dayKey = new Date(row.timestamp).toISOString().slice(0, 10);
    dayMap.set(dayKey, (dayMap.get(dayKey) ?? 0) + Number(row.amount ?? 0));
  }

  const dailySpendSeries: number[] = [];
  for (let i = lookbackDays - 1; i >= 0; i -= 1) {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - i);
    dailySpendSeries.push(dayMap.get(day.toISOString().slice(0, 10)) ?? 0);
  }

  const intelligence = await getProposalIntelligence({ ...query, recentExpenses, dailySpendSeries });
  res.json(intelligence);
});

router.get('/hotspots', async (req, res) => {
  const query = z
    .object({
      days: z.coerce.number().int().positive().optional().default(30),
      cellKm: z.coerce.number().positive().optional().default(1),
      limit: z.coerce.number().int().positive().optional().default(20),
      district: z.string().min(1).optional(),
      zone: z.string().min(1).optional()
    })
    .parse(req.query);

  const clusters = await getHotspots(query);
  res.json({ generatedAt: new Date().toISOString(), clusters });
});

router.get('/trends', async (req, res) => {
  const query = z
    .object({
      days: z.coerce.number().int().positive().optional().default(56),
      cellKm: z.coerce.number().positive().optional().default(1),
      limit: z.coerce.number().int().positive().optional().default(20),
      minRecent: z.coerce.number().int().positive().optional().default(2),
      district: z.string().min(1).optional(),
      zone: z.string().min(1).optional()
    })
    .parse(req.query);

  const trends = await getWorseningTrends(query);
  res.json({ generatedAt: new Date().toISOString(), windowDays: query.days, trends });
});

router.get('/export/roads.geojson', async (req, res) => {
  const query = z
    .object({
      chronicOnly: z.coerce.boolean().optional().default(false),
      chronicDays: z.coerce.number().int().positive().optional().default(60),
      district: z.string().min(1).optional(),
      zone: z.string().min(1).optional(),
      limit: z.coerce.number().int().positive().optional().default(5000)
    })
    .parse(req.query);

  const geo = await exportRoadsGeoJson(query);
  res.setHeader('Content-Type', 'application/geo+json');
  res.json(geo);
});

router.get('/export/roads.csv', async (req, res) => {
  const query = z
    .object({
      chronicOnly: z.coerce.boolean().optional().default(true),
      chronicDays: z.coerce.number().int().positive().optional().default(60),
      district: z.string().min(1).optional(),
      zone: z.string().min(1).optional(),
      limit: z.coerce.number().int().positive().optional().default(5000)
    })
    .parse(req.query);

  const chronic = query.chronicOnly
    ? await listChronicRoads({ days: query.chronicDays, limit: query.limit, district: query.district, zone: query.zone })
    : [];

  const rows = chronic.map((c) => ({
    complaintId: c.complaintId,
    district: c.district,
    zone: c.zone,
    status: c.status,
    ageDays: c.ageDays,
    lat: c.lat,
    lng: c.lng,
    createdAt: c.createdAt,
    description: c.description
  }));

  const csv = toCsv(rows, ['complaintId', 'district', 'zone', 'status', 'ageDays', 'lat', 'lng', 'createdAt', 'description']);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="roads${query.chronicOnly ? `-chronic-${query.chronicDays}d` : ''}.csv"`);
  res.send(csv);
});

router.get('/export/roads.pdf', async (req, res) => {
  const query = z
    .object({
      district: z.string().min(1).optional(),
      zone: z.string().min(1).optional(),
      chronicDays: z.coerce.number().int().positive().optional().default(60)
    })
    .parse(req.query);

  const byStatus = await getCountsByStatus({ district: query.district, zone: query.zone });
  const chronic = await listChronicRoads({ days: query.chronicDays, limit: 200, district: query.district, zone: query.zone });
  const contractors = await getContractorScorecard({ district: query.district, zone: query.zone, limit: 100 });

  const title = `RoadWatch Public Dashboard Export${query.district ? ` — ${query.district}` : ''}${query.zone ? ` / ${query.zone}` : ''}`;
  const pdf = await renderPublicRoadsPdf({ title, byStatus, chronic, contractors });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="public-roadwatch${query.district ? `-${query.district}` : ''}.pdf"`);
  res.send(pdf);
});

// Citizen opt-in share view for RTI escalation (redacted).
router.get('/rti/:shareToken', async (req, res) => {
  const params = z.object({ shareToken: z.string().uuid() }).parse(req.params);

  const rtiRes = await pool.query(
    `SELECT id, complaint_id, country_code, authority_name, subject, status, submitted_at, response_due_at, first_appeal_last_date, public_opt_in_at, created_at, updated_at
     FROM rti_requests
     WHERE public_share_token = $1 AND public_opt_in_at IS NOT NULL
     LIMIT 1`,
    [params.shareToken]
  );
  if (rtiRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });

  const responsesRes = await pool.query(
    `SELECT received_at, file_mime, file_sha256, notes, created_at
     FROM rti_responses
     WHERE rti_id = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [rtiRes.rows[0].id]
  );

  res.json({ rti: rtiRes.rows[0], recentResponses: responsesRes.rows });
});

export default router;