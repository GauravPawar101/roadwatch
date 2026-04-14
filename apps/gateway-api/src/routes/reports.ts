import express from 'express';
import { z } from 'zod';
import { getContractorScorecard, getHotspots } from '../analytics/service.js';
import { pool } from '../db.js';
import { assertDistrictAccess, requireAuth, requireRole } from '../rbac.js';
import { streamDistrictReportPdf } from '../reports/districtPdf.js';
import { streamMinistryReportPdf } from '../reports/ministryPdf.js';

const router = express.Router();

router.get('/district/:districtId.pdf', requireAuth, async (req, res) => {
  const user = (req as any).user as any;
  const district = req.params.districtId;
  if (!district) return res.status(400).json({ error: 'Missing districtId' });
  if (!assertDistrictAccess(user, district)) return res.status(403).json({ error: 'Forbidden' });

  const counts = await pool.query(
    `SELECT status, count(*)::int as count FROM complaints WHERE district = $1 GROUP BY status;`,
    [district]
  );
  const byStatus: Record<string, number> = {};
  for (const row of counts.rows) byStatus[row.status] = row.count;

  const topPending = await pool.query(
    `SELECT id, zone, description, status FROM complaints WHERE district = $1 AND status <> 'RESOLVED' ORDER BY updated_at DESC LIMIT 15;`,
    [district]
  );

  const pending = byStatus['PENDING'] ?? 0;
  const inProgress = byStatus['IN_PROGRESS'] ?? 0;
  const rejected = byStatus['REJECTED'] ?? 0;
  const resolved = byStatus['RESOLVED'] ?? 0;
  const total = pending + inProgress + rejected + resolved;

  const estimatedBacklogCostINR = pending * 25000 + inProgress * 10000 + rejected * 2000;

  streamDistrictReportPdf(res, {
    district,
    generatedAt: new Date().toISOString(),
    totals: {
      pending,
      inProgress,
      resolved,
      rejected,
      total
    },
    topPending: topPending.rows,
    budget: {
      estimatedBacklogCostINR,
      notes: 'Backlog cost estimate uses a fixed per-complaint model (configurable server-side).'
    }
  });
});

router.get('/ministry.pdf', requireAuth, requireRole(['CE']), async (req, res) => {
  const query = z
    .object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      chronicDays: z.coerce.number().int().positive().optional().default(60)
    })
    .parse(req.query);

  const totalsByStatus: Record<string, number> = {};
  const totals = await pool.query(`SELECT status, count(*)::int AS count FROM complaints GROUP BY status;`);
  for (const row of totals.rows as any[]) totalsByStatus[row.status] = row.count;

  const chronicCount = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM complaints
     WHERE status <> 'RESOLVED'
       AND created_at <= now() - ($1::int * interval '1 day');`,
    [query.chronicDays]
  );

  const districtBreakdown = await pool.query(
    `SELECT
        district,
        count(*)::int AS total,
        count(*) FILTER (WHERE status <> 'RESOLVED')::int AS unresolved,
        count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
        count(*) FILTER (WHERE status = 'ESCALATED')::int AS escalated
     FROM complaints
     GROUP BY district
     ORDER BY unresolved DESC, total DESC
     LIMIT 200;`
  );

  const hotspots = await getHotspots({ days: 30, cellKm: 1, limit: 20 });
  const contractors = await getContractorScorecard({ limit: 50 });

  streamMinistryReportPdf(res, {
    title: 'RoadWatch Ministry-Level Report',
    generatedAt: new Date().toISOString(),
    period: { from: query.from ?? null, to: query.to ?? null },
    totalsByStatus,
    chronic: { days: query.chronicDays, count: Number(chronicCount.rows[0]?.count ?? '0') },
    districts: (districtBreakdown.rows as any[]).map((d) => ({
      district: d.district,
      total: d.total,
      unresolved: d.unresolved,
      resolved: d.resolved,
      escalated: d.escalated
    })),
    hotspots: hotspots.map((h) => ({ key: h.key, count: h.count, centroid: h.centroid })),
    contractors: contractors.map((c) => ({
      contractorId: c.contractorId,
      contractorName: c.contractorName,
      assignedCount: c.assignedCount,
      resolvedCount: c.resolvedCount,
      openCount: c.openCount,
      avgResolutionDays: c.avgResolutionDays,
      onTimeRate: c.onTimeRate
    }))
  });
});

export default router;
