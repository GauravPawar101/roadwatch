import PDFDocument from 'pdfkit';
import type { Response } from 'express';

export type DistrictReportData = {
  district: string;
  generatedAt: string;
  totals: {
    pending: number;
    inProgress: number;
    resolved: number;
    rejected: number;
    total: number;
  };
  topPending: Array<{ id: string; zone: string; description: string; status: string }>;
  budget: {
    estimatedBacklogCostINR: number;
    notes: string;
  };
};

export function streamDistrictReportPdf(res: Response, data: DistrictReportData) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="district-report-${data.district}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  doc.fontSize(18).text('RoadWatch District Report', { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`District: ${data.district}`);
  doc.text(`Generated: ${data.generatedAt}`);

  doc.moveDown();
  doc.fontSize(14).text('Complaint Summary');
  doc.moveDown(0.5);
  doc.fontSize(11);
  doc.text(`Total: ${data.totals.total}`);
  doc.text(`Pending: ${data.totals.pending}`);
  doc.text(`In Progress: ${data.totals.inProgress}`);
  doc.text(`Resolved: ${data.totals.resolved}`);
  doc.text(`Rejected: ${data.totals.rejected}`);

  doc.moveDown();
  doc.fontSize(14).text('Budget');
  doc.moveDown(0.5);
  doc.fontSize(11).text(`Estimated backlog cost (INR): ${data.budget.estimatedBacklogCostINR.toLocaleString('en-IN')}`);
  doc.text(data.budget.notes);

  doc.moveDown();
  doc.fontSize(14).text('Top Pending Complaints');
  doc.moveDown(0.5);
  doc.fontSize(10);
  for (const c of data.topPending) {
    doc.text(`${c.id} [${c.zone}] (${c.status}) - ${c.description}`);
  }

  doc.end();
}
