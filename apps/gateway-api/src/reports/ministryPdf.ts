import type { Response } from 'express';
import PDFDocument from 'pdfkit';

export type MinistryReportData = {
  title: string;
  generatedAt: string;
  period: { from: string | null; to: string | null };
  totalsByStatus: Record<string, number>;
  chronic: { days: number; count: number };
  districts: Array<{
    district: string;
    total: number;
    unresolved: number;
    resolved: number;
    escalated: number;
  }>;
  hotspots: Array<{ key: string; count: number; centroid: { lat: number; lng: number } }>;
  contractors: Array<{
    contractorId: string;
    contractorName: string;
    assignedCount: number;
    resolvedCount: number;
    openCount: number;
    avgResolutionDays: number | null;
    onTimeRate: number | null;
  }>;
};

export function streamMinistryReportPdf(res: Response, data: MinistryReportData) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ministry-report.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  doc.fontSize(18).text(data.title, { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#444444').text(`Generated: ${data.generatedAt}`);
  doc.text(`Period: ${data.period.from ?? '—'} to ${data.period.to ?? '—'}`);
  doc.fillColor('#000000');

  doc.moveDown();
  doc.fontSize(14).text('National Summary');
  doc.moveDown(0.5);
  doc.fontSize(11);

  const entries = Object.entries(data.totalsByStatus).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((acc, [, v]) => acc + v, 0);
  doc.text(`Total complaints: ${total}`);
  for (const [status, count] of entries) doc.text(`${status}: ${count}`);

  doc.moveDown(0.5);
  doc.text(`Chronic (>= ${data.chronic.days} days unresolved): ${data.chronic.count}`);

  doc.moveDown();
  doc.fontSize(14).text('District Breakdown');
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#444444').text('District | Total | Unresolved | Resolved | Escalated');
  doc.fillColor('#000000');

  for (const d of data.districts.slice(0, 50)) {
    doc.fontSize(10).text(`${d.district} | ${d.total} | ${d.unresolved} | ${d.resolved} | ${d.escalated}`);
  }

  doc.moveDown();
  doc.fontSize(14).text('Hotspots (Top clusters)');
  doc.moveDown(0.5);
  doc.fontSize(10);
  if (!data.hotspots.length) {
    doc.text('No hotspot data available.');
  } else {
    for (const h of data.hotspots.slice(0, 20)) {
      doc.text(`${h.key} — ${h.count} complaints — (${h.centroid.lat.toFixed(4)}, ${h.centroid.lng.toFixed(4)})`);
    }
  }

  doc.moveDown();
  doc.fontSize(14).text('Contractor Performance (Public scorecard basis)');
  doc.moveDown(0.5);
  doc.fontSize(10);
  if (!data.contractors.length) {
    doc.text('No contractor assignment data available.');
  } else {
    for (const c of data.contractors.slice(0, 30)) {
      const onTime = c.onTimeRate == null ? '—' : `${Math.round(c.onTimeRate * 100)}%`;
      const avg = c.avgResolutionDays == null ? '—' : `${c.avgResolutionDays.toFixed(1)}d`;
      doc.text(`${c.contractorName} (${c.contractorId}) — assigned ${c.assignedCount}, resolved ${c.resolvedCount}, open ${c.openCount}, avg ${avg}, on-time ${onTime}`);
    }
  }

  doc.end();
}
