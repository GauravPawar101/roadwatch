import express from 'express';
import { z } from 'zod';
import { getContractorScorecard, getHotspots } from '../analytics/service.js';
import { execute } from '../cassandra.js';
import { assertDistrictAccess, requireAuth, requireRole } from '../rbac.js';
import { streamDistrictReportPdf } from '../reports/districtPdf.js';
import { streamMinistryReportPdf } from '../reports/ministryPdf.js';

const router = express.Router();

router.get('/district/:districtId.pdf', requireAuth, async (req, res) => {
  const user = (req as any).user as any;
  const district = req.params.districtId;
  if (!district) return res.status(400).json({ error: 'Missing districtId' });
  if (!assertDistrictAccess(user, district)) return res.status(403).json({ error: 'Forbidden' });

  // Fetch complaints for district and aggregate in application code (PoC). Replace with denormalized tables for production.
  const rowsRes = await execute('SELECT id, zone, description, status, updated_at FROM complaints WHERE district = ? ALLOW FILTERING', [district], { prepare: true });
  const byStatus: Record<string, number> = {};
  for (const r of rowsRes.rows as any[]) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const topPending = (rowsRes.rows as any[])
    .filter((r) => r.status !== 'RESOLVED')
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 15)
    .map((r) => ({ id: r.id, zone: r.zone, description: r.description, status: r.status }));

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
  const query = z
    .object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      chronicDays: z.coerce.number().int().positive().optional().default(60)
    })
    .parse(req.query);

  // Aggregate across all complaints in app code (PoC). Replace with materialized views/denormalized tables for production.
  const allRows = await execute('SELECT id, district, status, created_at FROM complaints ALLOW FILTERING', [], { prepare: true });
  const totalsByStatus: Record<string, number> = {};
  for (const r of allRows.rows as any[]) totalsByStatus[r.status] = (totalsByStatus[r.status] ?? 0) + 1;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - query.chronicDays);
  const chronicCount = { rows: [{ count: String(allRows.rows.filter((r: any) => r.status !== 'RESOLVED' && new Date(r.created_at) <= cutoff).length) }] } as any;

  const districtMap: Record<string, { district: string; total: number; unresolved: number; resolved: number; escalated: number }> = {};
  for (const r of allRows.rows as any[]) {
    const d = String(r.district ?? 'UNK');
    districtMap[d] = districtMap[d] || { district: d, total: 0, unresolved: 0, resolved: 0, escalated: 0 };
    districtMap[d].total += 1;
    if (r.status !== 'RESOLVED') districtMap[d].unresolved += 1;
    if (r.status === 'RESOLVED') districtMap[d].resolved += 1;
    if (r.status === 'ESCALATED') districtMap[d].escalated += 1;
  }
  const districtBreakdown = Object.values(districtMap).sort((a, b) => (b.unresolved - a.unresolved) || (b.total - a.total)).slice(0, 200);

  const hotspots = await getHotspots({ days: 30, cellKm: 1, limit: 20 });
  const contractors = await getContractorScorecard({ limit: 50 });

  streamMinistryReportPdf(res, {
    title: 'RoadWatch Ministry-Level Report',
    generatedAt: new Date().toISOString(),
    period: { from: query.from ?? null, to: query.to ?? null },
    totalsByStatus,
    chronic: { days: query.chronicDays, count: Number(chronicCount.rows[0]?.count ?? '0') },
    districts: (districtBreakdown as any[]).map((d) => ({
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
