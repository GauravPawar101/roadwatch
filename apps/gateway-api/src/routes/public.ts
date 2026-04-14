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
import {
    getDistrictOfflineManifest,
    listCountries,
    listDistricts,
    listRoadsForDistrict,
    listStates,
    pool
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

    const d = await pool.query(
      `SELECT id
       FROM districts
       WHERE $1 BETWEEN LEAST(bottom_right_lat, top_left_lat) AND GREATEST(bottom_right_lat, top_left_lat)
         AND $2 BETWEEN LEAST(top_left_lng, bottom_right_lng) AND GREATEST(top_left_lng, bottom_right_lng)
       LIMIT 1;`,
      [query.lat, query.lng]
    );
    districtId = d.rows[0]?.id;
    if (!districtId) return res.json({ type: 'FeatureCollection', features: [] });
  }

  const limit = Math.min(20000, Math.max(1, query.limit));
  const r = await pool.query(
    `SELECT
        rc.id,
        rc.name,
        rc.road_type,
        rc.authority_id,
        rc.geometry,
        d.code AS district_code,
        ad.name AS authority_name,
        ad.department AS authority_department,
        ad.public_phone AS authority_public_phone,
        ad.public_email AS authority_public_email,
        ad.website AS authority_website,
        ad.address AS authority_address,
        ra.contractor_id,
        c.name AS contractor_name,
        c.contact_phone_masked AS contractor_phone_masked,
        ra.engineer_user_id,
        u.govt_id AS engineer_govt_id,
        ra.starts_on,
        ra.ends_on
     FROM roads_catalog rc
     JOIN districts d ON d.id = rc.district_id
     LEFT JOIN authority_directory ad ON ad.authority_id = rc.authority_id
     LEFT JOIN LATERAL (
       SELECT * FROM road_assignments x
       WHERE x.road_id = rc.id
       ORDER BY x.created_at DESC
       LIMIT 1
     ) ra ON TRUE
     LEFT JOIN contractors c ON c.id = ra.contractor_id
     LEFT JOIN users u ON u.id = ra.engineer_user_id
     WHERE rc.district_id = $1
       AND rc.geometry IS NOT NULL
     ORDER BY rc.id ASC
     LIMIT $2;`,
    [districtId, limit]
  );

  res.setHeader('Content-Type', 'application/geo+json');
  res.json({
    type: 'FeatureCollection',
    features: (r.rows as any[]).map((row) => ({
      type: 'Feature',
      geometry: row.geometry,
      properties: {
        roadId: row.id,
        name: row.name,
        roadType: row.road_type,
        authorityId: row.authority_id,
        districtCode: row.district_code,
        assignment: {
          contractorId: row.contractor_id ?? null,
          contractorName: row.contractor_name ?? null,
          contractorPhoneMasked: row.contractor_phone_masked ?? null,
          engineerUserId: row.engineer_user_id ?? null,
          engineerGovtId: row.engineer_govt_id ?? null,
          startsOn: row.starts_on ? new Date(row.starts_on).toISOString().slice(0, 10) : null,
          endsOn: row.ends_on ? new Date(row.ends_on).toISOString().slice(0, 10) : null
        },
        authority: {
          name: row.authority_name ?? null,
          department: row.authority_department ?? null,
          publicPhone: row.authority_public_phone ?? null,
          publicEmail: row.authority_public_email ?? null,
          website: row.authority_website ?? null,
          address: row.authority_address ?? null
        }
      }
    }))
  });
});

router.get('/authorities/:authorityId', async (req, res) => {
  const params = z.object({ authorityId: z.string().min(1) }).parse(req.params);
  const r = await pool.query(
    `SELECT authority_id, name, department, public_phone, public_email, website, address, updated_at
     FROM authority_directory
     WHERE authority_id = $1
     LIMIT 1;`,
    [params.authorityId]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
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

  const rti = await pool.query(
    `SELECT id, complaint_id, country_code, authority_name, subject, status,
            submitted_at, response_due_at, first_appeal_last_date, public_opt_in_at, created_at, updated_at
     FROM rti_requests
     WHERE public_share_token = $1::uuid AND public_opt_in_at IS NOT NULL
     LIMIT 1;`,
    [params.shareToken]
  );

  if (rti.rowCount === 0) return res.status(404).json({ error: 'Not found' });

  const responses = await pool.query(
    `SELECT received_at, file_mime, file_sha256, notes, created_at
     FROM rti_responses
     WHERE rti_id = $1
     ORDER BY created_at DESC
     LIMIT 5;`,
    [rti.rows[0].id]
  );

  res.json({ rti: rti.rows[0], recentResponses: responses.rows });
});
export default router;
