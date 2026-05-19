import express from 'express';
import { z } from 'zod';
import {
    exportRoadsGeoJson,
    getContractorScorecard,
    getCountsByStatus,
    getHotspots,
    getWorseningTrends,
    listChronicRoads,
    renderPublicRoadsPdf,
    toCsv
} from '../analytics/service.js';
import { execute } from '../cassandra.js';
import {
    getDistrictOfflineManifest,
    listCountries,
    listDistricts,
    listRoadsForDistrict,
    listStates
} from '../db.js';

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

    // Cassandra: load districts and resolve by bbox in-app (PoC)
    const allDistricts = await execute('SELECT id, bottom_right_lat, top_left_lat, top_left_lng, bottom_right_lng FROM districts ALLOW FILTERING', [], { prepare: true });
    const found = (allDistricts.rows as any[]).find((d) => {
      const lat = Number(query.lat);
      const lng = Number(query.lng);
      const bottom = Math.min(Number(d.bottom_right_lat), Number(d.top_left_lat));
      const top = Math.max(Number(d.bottom_right_lat), Number(d.top_left_lat));
      const left = Math.min(Number(d.top_left_lng), Number(d.bottom_right_lng));
      const right = Math.max(Number(d.top_left_lng), Number(d.bottom_right_lng));
      return lat >= bottom && lat <= top && lng >= left && lng <= right;
    });
    districtId = found?.id;
    if (!districtId) return res.json({ type: 'FeatureCollection', features: [] });
  }

  const limit = Math.min(20000, Math.max(1, query.limit));
  const roadsRes = await execute('SELECT id, name, road_type, authority_id, geometry, district_id FROM roads_catalog WHERE district_id = ? AND geometry IS NOT NULL ALLOW FILTERING LIMIT ?', [districtId, limit], { prepare: true });

  // Prefetch related authority and assignment info (PoC doing per-id lookups)
  const authorityIds = Array.from(new Set((roadsRes.rows as any[]).map((r) => r.authority_id).filter(Boolean)));
  const authorities: Record<string, any> = {};
  for (const aid of authorityIds) {
    const ar = await execute('SELECT authority_id, name, department, public_phone, public_email, website, address FROM authority_directory WHERE authority_id = ? LIMIT 1', [aid], { prepare: true });
    if (ar.rows && ar.rows[0]) authorities[aid] = ar.rows[0];
  }

  const features = [];
  for (const row of roadsRes.rows as any[]) {
    // latest assignment (by created_at) - fetch and choose latest in-app
    const raRows = await execute('SELECT contractor_id, engineer_user_id, starts_on, ends_on, created_at FROM road_assignments WHERE road_id = ? ALLOW FILTERING', [row.id], { prepare: true });
    const latestRa = (raRows.rows as any[]).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;
    let contractorName = null;
    let contractorPhoneMasked = null;
    if (latestRa?.contractor_id) {
      const cRes = await execute('SELECT id, name, contact_phone_masked FROM contractors WHERE id = ? LIMIT 1', [latestRa.contractor_id], { prepare: true });
      if (cRes.rows && cRes.rows[0]) {
        contractorName = cRes.rows[0].name;
        contractorPhoneMasked = cRes.rows[0].contact_phone_masked;
      }
    }

    let engineerGovtId = null;
    if (latestRa?.engineer_user_id) {
      const uRes = await execute('SELECT id, govt_id FROM users WHERE id = ? LIMIT 1', [latestRa.engineer_user_id], { prepare: true });
      if (uRes.rows && uRes.rows[0]) engineerGovtId = uRes.rows[0].govt_id ?? null;
    }

    const ad = authorities[row.authority_id] ?? null;

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
          contractorId: latestRa?.contractor_id ?? null,
          contractorName: contractorName,
          contractorPhoneMasked: contractorPhoneMasked,
          engineerUserId: latestRa?.engineer_user_id ?? null,
          engineerGovtId: engineerGovtId,
          startsOn: latestRa?.starts_on ? new Date(latestRa.starts_on).toISOString().slice(0, 10) : null,
          endsOn: latestRa?.ends_on ? new Date(latestRa.ends_on).toISOString().slice(0, 10) : null
        },
        authority: {
          name: ad?.name ?? null,
          department: ad?.department ?? null,
          publicPhone: ad?.public_phone ?? null,
          publicEmail: ad?.public_email ?? null,
          website: ad?.website ?? null,
          address: ad?.address ?? null
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
  const r = await execute('SELECT authority_id, name, department, public_phone, public_email, website, address, updated_at FROM authority_directory WHERE authority_id = ? LIMIT 1', [params.authorityId], { prepare: true });
  if (!r.rows || r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ authority: r.rows[0] });
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

  const rtiRes = await execute('SELECT id, complaint_id, country_code, authority_name, subject, status, submitted_at, response_due_at, first_appeal_last_date, public_opt_in_at, created_at, updated_at FROM rti_requests WHERE public_share_token = ? LIMIT 1 ALLOW FILTERING', [params.shareToken], { prepare: true });
  if (!rtiRes.rows || rtiRes.rows.length === 0 || !rtiRes.rows[0].public_opt_in_at) return res.status(404).json({ error: 'Not found' });

  const responsesRes = await execute('SELECT received_at, file_mime, file_sha256, notes, created_at FROM rti_responses WHERE rti_id = ? ALLOW FILTERING', [rtiRes.rows[0].id], { prepare: true });
  const recentResponses = (responsesRes.rows as any[]).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5);

  res.json({ rti: rtiRes.rows[0], recentResponses });
});
export default router;
