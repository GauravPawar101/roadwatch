import express from 'express';
import { z } from 'zod';
import { getContractorScorecard, getHotspots } from '../analytics/service.js';
import { query } from '../postgres.js';
import { assertDistrictAccess, requireAuth, requireRole } from '../rbac.js';
import { streamDistrictReportPdf } from '../reports/districtPdf.js';
import { streamMinistryReportPdf } from '../reports/ministryPdf.js';

const router = express.Router();

router.get('/district/:districtId.pdf', requireAuth, async (req, res) => {
  const user = (req as any).user as any;
  const district = req.params.districtId;
  if (!district) return res.status(400).json({ error: 'Missing districtId' });
  if (!assertDistrictAccess(user, district)) return res.status(403).json({ error: 'Forbidden' });

  // Native Postgres query using tagged template literals
  const complaints = await query(`
    SELECT id, zone, description, status, updated_at 
    FROM complaints 
    WHERE district = $1`, [district]);

  const byStatus: Record<string, number> = {};
  for (const r of complaints.rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  const topPending = (complaints.rows as any[])
    .filter((r) => r.status !== 'RESOLVED')
    // postgres.js automatically instantiates timestamp columns into raw JS Date objects
    .sort((a: any, b: any) => b.updated_at.getTime() - a.updated_at.getTime())
    .slice(0, 15)
    .map((r: any) => ({ id: r.id, zone: r.zone, description: r.description, status: r.status }));

  const pending = byStatus['FILED'] ?? 0;
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
    topPending: topPending,
    budget: {
      estimatedBacklogCostINR,
      notes: 'Backlog cost estimate uses a fixed per-complaint model (configurable server-side).'
    }
  });
});

router.get('/ministry.pdf', requireAuth, requireRole(['CE']), async (req, res) => {
  const params = z
    .object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      chronicDays: z.coerce.number().int().positive().optional().default(60)
    })
    .parse(req.query);

  // Native Postgres dump for processing calculations
  const { rows: allRows } = await query(`SELECT id, district, status, created_at FROM complaints`);
  
  const totalsByStatus: Record<string, number> = {};
  for (const r of allRows) {
    totalsByStatus[r.status] = (totalsByStatus[r.status] ?? 0) + 1;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - params.chronicDays);
  
  const chronicCount = allRows.filter(
    (r: any) => r.status !== 'RESOLVED' && r.created_at <= cutoff
  ).length;

  const districtMap: Record<string, { district: string; total: number; unresolved: number; resolved: number; escalated: number }> = {};
  for (const r of allRows) {
    const d = String(r.district ?? 'UNK');
    districtMap[d] = districtMap[d] || { district: d, total: 0, unresolved: 0, resolved: 0, escalated: 0 };
    districtMap[d].total += 1;
    if (r.status !== 'RESOLVED') districtMap[d].unresolved += 1;
    if (r.status === 'RESOLVED') districtMap[d].resolved += 1;
    if (r.status === 'ESCALATED') districtMap[d].escalated += 1;
  }
  
  const districtBreakdown = Object.values(districtMap)
    .sort((a: any, b: any) => (b.unresolved - a.unresolved) || (b.total - a.total))
    .slice(0, 200);

  const hotspots = await getHotspots({ days: 30, cellKm: 1, limit: 20 });
  const contractors = await getContractorScorecard({ limit: 50 });

  streamMinistryReportPdf(res, {
    title: 'RoadWatch Ministry-Level Report',
    generatedAt: new Date().toISOString(),
    period: { from: params.from ?? null, to: params.to ?? null },
    totalsByStatus,
    chronic: { days: params.chronicDays, count: chronicCount },
    districts: districtBreakdown.map((d: any) => ({
      district: d.district,
      total: d.total,
      unresolved: d.unresolved,
      resolved: d.resolved,
      escalated: d.escalated
    })),
    hotspots: hotspots.map((h: any) => ({ key: h.key, count: h.count, centroid: h.centroid })),
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