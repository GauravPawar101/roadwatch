import archiver from 'archiver';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { execute } from '../cassandra.js';
import { calculateRtiDeadlines } from '../legal/rtiDeadlines.js';

const router = express.Router();

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'rti');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function mustToken(req: express.Request): string {
  const token = typeof req.query.token === 'string' ? req.query.token : undefined;
  if (!token) {
    const err = new Error('Missing token');
    (err as any).statusCode = 401;
    throw err;
  }
  return token;
}

async function assertTokenAccess(rtiId: string, token: string) {
  const r = await execute('SELECT id FROM rti_requests WHERE id = ? AND tracking_token = ?', [rtiId, token], { prepare: true });
  if (!r.rows || r.rows.length === 0) {
    const err = new Error('Invalid token');
    (err as any).statusCode = 403;
    throw err;
  }
}

// Multer storage: keep files on local disk (dev-friendly). In production, swap for object storage.
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureDir(UPLOAD_ROOT);
      cb(null, UPLOAD_ROOT);
    } catch (e) {
      cb(e as Error, UPLOAD_ROOT);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `${crypto.randomUUID()}${ext || ''}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/', async (req, res) => {
  const body = z
    .object({
      complaintId: z.string().min(1).optional(),
      countryCode: z.string().min(2).max(3),
      authorityName: z.string().min(2),
      subject: z.string().min(2),
      requestText: z.string().min(10),
      status: z.enum(['DRAFT', 'FILED']).optional().default('FILED'),
      submittedAt: z.string().datetime().optional(),
      isLifeOrLiberty: z.boolean().optional()
    })
    .parse(req.body);

  const submittedAt = body.status === 'FILED' ? (body.submittedAt ? new Date(body.submittedAt) : new Date()) : null;
  const deadlines =
    body.status === 'FILED' && submittedAt
      ? calculateRtiDeadlines({
          countryCode: body.countryCode,
          submittedAt,
          isLifeOrLiberty: body.isLifeOrLiberty
        })
      : null;

  const trackingToken = crypto.randomUUID();

  // Generate RTI id client-side and insert into Cassandra
  const rtiId = `RTI-${crypto.randomUUID()}`;
  await execute(
    'INSERT INTO rti_requests (id, complaint_id, country_code, authority_name, subject, request_text, status, submitted_at, response_due_at, first_appeal_last_date, second_appeal_last_date, tracking_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      rtiId,
      body.complaintId ?? null,
      body.countryCode.toUpperCase(),
      body.authorityName,
      body.subject,
      body.requestText,
      body.status,
      submittedAt,
      deadlines?.responseDueAt ?? null,
      deadlines?.firstAppealLastDate ?? null,
      deadlines?.secondAppealLastDate ?? null,
      trackingToken,
      new Date(),
      new Date()
    ],
    { prepare: true }
  );

  await execute('INSERT INTO rti_events (rti_id, type, properties, occurred_at) VALUES (?, ?, ?, ?)', [
    rtiId,
    body.status === 'FILED' ? 'RTI_FILED' : 'RTI_DRAFT_CREATED',
    JSON.stringify({ basis: deadlines?.basis ?? null }),
    new Date()
  ], { prepare: true });

  // Return a shape similar to Postgres row
  res.json({
    rti: {
      id: rtiId,
      complaint_id: body.complaintId ?? null,
      country_code: body.countryCode.toUpperCase(),
      authority_name: body.authorityName,
      subject: body.subject,
      request_text: body.requestText,
      status: body.status,
      submitted_at: submittedAt,
      response_due_at: deadlines?.responseDueAt ?? null,
      first_appeal_last_date: deadlines?.firstAppealLastDate ?? null,
      second_appeal_last_date: deadlines?.secondAppealLastDate ?? null,
      tracking_token: trackingToken,
      public_opt_in_at: null,
      public_share_token: null,
      created_at: new Date(),
      updated_at: new Date(),
      deadlines: deadlines
        ? {
            responseDueAt: deadlines.responseDueAt,
            firstAppealLastDate: deadlines.firstAppealLastDate,
            basis: deadlines.basis
          }
        : null
    }
  });
});

// Update a draft before filing (token-tracked)
router.put('/:id/draft', async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  const body = z
    .object({
      authorityName: z.string().min(2).optional(),
      subject: z.string().min(2).optional(),
      requestText: z.string().min(10).optional(),
      complaintId: z.string().min(1).optional().nullable()
    })
    .refine((x) => Object.keys(x).length > 0, { message: 'No fields to update' })
    .parse(req.body);

  const existing = await execute('SELECT status, authority_name, subject, request_text, complaint_id FROM rti_requests WHERE id = ? LIMIT 1', [params.id], { prepare: true });
  if (!existing.rows || existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  if (existing.rows[0].status !== 'DRAFT') return res.status(409).json({ error: 'Only DRAFT RTIs can be edited' });

  // Merge updates in application code and persist
  const merged = {
    authority_name: body.authorityName ?? existing.rows[0].authority_name,
    subject: body.subject ?? existing.rows[0].subject,
    request_text: body.requestText ?? existing.rows[0].request_text,
    complaint_id: body.complaintId ?? existing.rows[0].complaint_id
  };

  await execute('UPDATE rti_requests SET authority_name = ?, subject = ?, request_text = ?, complaint_id = ?, updated_at = ? WHERE id = ?', [merged.authority_name, merged.subject, merged.request_text, merged.complaint_id, new Date(), params.id], { prepare: true });

  await execute('INSERT INTO rti_events (rti_id, type, properties, occurred_at) VALUES (?, ?, ?, ?)', [params.id, 'RTI_DRAFT_UPDATED', JSON.stringify({ updated: Object.keys(body) }), new Date()], { prepare: true });

  res.json({ ok: true });
});

// File/submit a draft (computes deadlines and transitions to FILED)
router.post('/:id/file', async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  const body = z
    .object({
      submittedAt: z.string().datetime().optional(),
      isLifeOrLiberty: z.boolean().optional()
    })
    .parse(req.body ?? {});

  const existing = await execute('SELECT id, status, country_code, submitted_at FROM rti_requests WHERE id = ? LIMIT 1', [params.id], { prepare: true });
  if (!existing.rows || existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });

  const currentStatus = existing.rows[0].status as string;
  if (currentStatus !== 'DRAFT') {
    // Idempotent: if already filed, return current row.
    const rowRes = await execute('SELECT id, complaint_id, country_code, authority_name, subject, request_text, status, submitted_at, response_due_at, first_appeal_last_date, second_appeal_last_date, public_opt_in_at, public_share_token, created_at, updated_at FROM rti_requests WHERE id = ?', [params.id], { prepare: true });
    return res.json({ ok: true, rti: rowRes.rows[0] });
  }

  const submittedAt = body.submittedAt ? new Date(body.submittedAt) : new Date();
  const deadlines = calculateRtiDeadlines({
    countryCode: String(existing.rows[0].country_code),
    submittedAt,
    isLifeOrLiberty: body.isLifeOrLiberty
  });

  await execute('UPDATE rti_requests SET status = ?, submitted_at = ?, response_due_at = ?, first_appeal_last_date = ?, second_appeal_last_date = ?, updated_at = ? WHERE id = ?', ['FILED', submittedAt, deadlines.responseDueAt, deadlines.firstAppealLastDate, deadlines.secondAppealLastDate ?? null, new Date(), params.id], { prepare: true });

  await execute('INSERT INTO rti_events (rti_id, type, properties, occurred_at) VALUES (?, ?, ?, ?)', [params.id, 'RTI_FILED', JSON.stringify({ basis: deadlines.basis }), new Date()], { prepare: true });

  const rowRes = await execute('SELECT id, complaint_id, country_code, authority_name, subject, request_text, status, submitted_at, response_due_at, first_appeal_last_date, second_appeal_last_date, public_opt_in_at, public_share_token, created_at, updated_at FROM rti_requests WHERE id = ?', [params.id], { prepare: true });

  res.json({ ok: true, rti: rowRes.rows[0], deadlines: { ...deadlines } });
});

router.get('/:id', async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  const rtiRes = await execute('SELECT id, complaint_id, country_code, authority_name, subject, request_text, status, submitted_at, response_due_at, first_appeal_last_date, second_appeal_last_date, public_opt_in_at, public_share_token, created_at, updated_at FROM rti_requests WHERE id = ?', [params.id], { prepare: true });
  const responses = await execute('SELECT id, received_at, file_mime, file_sha256, notes, created_at FROM rti_responses WHERE rti_id = ? ORDER BY created_at DESC', [params.id], { prepare: true });
  const attachments = await execute('SELECT id, kind, file_mime, file_sha256, note, created_at FROM rti_attachments WHERE rti_id = ? ORDER BY created_at DESC', [params.id], { prepare: true });
  const events = await execute('SELECT id, type, occurred_at, properties FROM rti_events WHERE rti_id = ? ORDER BY occurred_at ASC', [params.id], { prepare: true });

  res.json({ rti: rtiRes.rows[0], responses: responses.rows, attachments: attachments.rows, events: events.rows });
});

router.post('/:id/status', async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  const body = z
    .object({
      status: z.enum(['ACKNOWLEDGED', 'RESPONDED', 'APPEALED', 'CLOSED'])
    })
    .parse(req.body);

  await execute('UPDATE rti_requests SET status = ?, updated_at = ? WHERE id = ?', [body.status, new Date(), params.id], { prepare: true });
  await execute('INSERT INTO rti_events (rti_id, type, properties, occurred_at) VALUES (?, ?, ?, ?)', [params.id, `RTI_${body.status}`, JSON.stringify({}), new Date()], { prepare: true });

  res.json({ ok: true });
});

router.post('/:id/response', upload.single('response'), async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  if (!req.file) return res.status(400).json({ error: 'Missing response file' });

  const notes = typeof req.body?.notes === 'string' ? req.body.notes : null;
  const fileSha = await sha256File(req.file.path);

  await execute('INSERT INTO rti_responses (id, rti_id, file_path, file_mime, file_sha256, notes, received_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), params.id, req.file.path, req.file.mimetype ?? null, fileSha, notes, new Date(), new Date()], { prepare: true });

  await execute('UPDATE rti_requests SET status = ?, updated_at = ? WHERE id = ?', ['RESPONDED', new Date(), params.id], { prepare: true });
  await execute('INSERT INTO rti_events (rti_id, type, properties, occurred_at) VALUES (?, ?, ?, ?)', [params.id, 'RTI_RESPONSE_UPLOADED', JSON.stringify({ fileSha256: fileSha, mime: req.file.mimetype ?? null }), new Date()], { prepare: true });

  res.json({ ok: true, fileSha256: fileSha });
});

router.post('/:id/attachments', upload.array('files', 10), async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  const kind = z.enum(['PHOTO', 'VIDEO', 'DOCUMENT']).parse(req.body?.kind);
  const note = typeof req.body?.note === 'string' ? req.body.note : null;

  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) return res.status(400).json({ error: 'Missing files' });

  const saved: Array<{ sha256: string; mime: string | null }> = [];

    for (const file of files) {
    const fileSha = await sha256File(file.path);
    await execute('INSERT INTO rti_attachments (id, rti_id, kind, file_path, file_mime, file_sha256, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), params.id, kind, file.path, file.mimetype ?? null, fileSha, note, new Date()], { prepare: true });
    saved.push({ sha256: fileSha, mime: file.mimetype ?? null });
  }

  await execute('INSERT INTO rti_events (rti_id, type, properties, occurred_at) VALUES (?, ?, ?, ?)', [params.id, 'RTI_ATTACHMENTS_ADDED', JSON.stringify({ count: files.length, kind }), new Date()], { prepare: true });

  res.json({ ok: true, files: saved });
});

router.post('/:id/escalate', async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  const body = z
    .object({
      channel: z.enum(['NGO', 'MEDIA']),
      makePublic: z.boolean().default(false)
    })
    .parse(req.body);

  const shareToken = body.makePublic ? crypto.randomUUID() : null;

  // Read current value and update atomically in app
  const cur = await execute('SELECT public_share_token FROM rti_requests WHERE id = ? LIMIT 1', [params.id], { prepare: true });
  const existingShare = cur.rows && cur.rows[0] ? cur.rows[0].public_share_token : null;
  const shareToSet = existingShare ?? shareToken;
  await execute('UPDATE rti_requests SET public_opt_in_at = ?, public_share_token = ?, updated_at = ? WHERE id = ?', [new Date(), shareToSet, new Date(), params.id], { prepare: true });

  await execute('INSERT INTO rti_events (rti_id, type, properties, occurred_at) VALUES (?, ?, ?, ?)', [params.id, 'RTI_ESCALATED', JSON.stringify({ channel: body.channel, makePublic: body.makePublic }), new Date()], { prepare: true });

  res.json({
    ok: true,
    publicShareToken: body.makePublic ? shareToken : null,
    publicUrl: body.makePublic && shareToken ? `/public/rti/${shareToken}` : null
  });
});

// One-tap evidence package for a lawyer/journalist.
// Includes: RTI request + events + responses + attachments + linked complaint/audit info + fabric txids (when present).
router.get('/:id/evidence.zip', async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  const rtiRes = await execute('SELECT * FROM rti_requests WHERE id = ? LIMIT 1', [params.id], { prepare: true });
  if (!rtiRes.rows || rtiRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });

  const events = await execute('SELECT id, type, occurred_at, properties FROM rti_events WHERE rti_id = ?', [params.id], { prepare: true });
  const responses = await execute('SELECT id, received_at, file_path, file_mime, file_sha256, notes, created_at FROM rti_responses WHERE rti_id = ?', [params.id], { prepare: true });
  const attachments = await execute('SELECT id, kind, file_path, file_mime, file_sha256, note, created_at FROM rti_attachments WHERE rti_id = ?', [params.id], { prepare: true });

  const linkedComplaintId = rtiRes.rows[0].complaint_id as string | null;
  const complaintRow = linkedComplaintId ? (await execute('SELECT * FROM complaints WHERE id = ? LIMIT 1', [linkedComplaintId], { prepare: true })).rows[0] ?? null : null;

  const auditRows = linkedComplaintId ? (await execute(`SELECT id, action, target_type, target_id, details, fabric_txid, created_at FROM audit_log WHERE target_type = ? AND target_id = ?`, ['COMPLAINT', linkedComplaintId], { prepare: true })).rows : [];

  const fabricTxids = new Set<string>();
  if (complaintRow?.fabric_txid) fabricTxids.add(String(complaintRow.fabric_txid));
  for (const row of auditRows) {
    if (row.fabric_txid) fabricTxids.add(String(row.fabric_txid));
  }

  const evidenceJson = {
    generatedAt: new Date().toISOString(),
    rtiId: params.id,
    complaintId: linkedComplaintId,
    fabricTxids: Array.from(fabricTxids.values())
  };

  const rtiJsonText = JSON.stringify(rtiRes.rows[0], null, 2);
  const eventsJsonText = JSON.stringify(events.rows, null, 2);
  const responsesJsonText = JSON.stringify(
    responses.rows.map((x: any) => ({ ...x, file_path: undefined })),
    null,
    2
  );
  const attachmentsJsonText = JSON.stringify(
    attachments.rows.map((x: any) => ({ ...x, file_path: undefined })),
    null,
    2
  );
  const complaintJsonText = complaintRow ? JSON.stringify(complaintRow, null, 2) : JSON.stringify(null);
  const auditJsonText = JSON.stringify(auditRows, null, 2);
  const evidenceJsonText = JSON.stringify(evidenceJson, null, 2);

  const manifest: {
    schema: string;
    generatedAt: string;
    files: Array<{ name: string; sha256: string; mime?: string | null }>;
    notes: string[];
  } = {
    schema: 'roadwatch-evidence-manifest/v1',
    generatedAt: new Date().toISOString(),
    files: [],
    notes: [
      'This bundle is generated by RoadWatch gateway-api.',
      'File hashes are SHA-256 over the raw file bytes.',
      'Fabric txids are included when present in the operational DB; for court, obtain block/endorsement data from the Fabric network and preserve chain-of-custody.'
    ]
  };

  function addTextFile(name: string, text: string) {
    manifest.files.push({ name, sha256: sha256Text(text), mime: 'application/json' });
    return { name, text };
  }

  const textFiles = [
    addTextFile('rti/rti.json', rtiJsonText),
    addTextFile('rti/events.json', eventsJsonText),
    addTextFile('rti/responses.json', responsesJsonText),
    addTextFile('rti/attachments.json', attachmentsJsonText),
    addTextFile('complaint/complaint.json', complaintJsonText),
    addTextFile('complaint/audit-log.json', auditJsonText),
    addTextFile('blockchain/receipts.json', evidenceJsonText)
  ];

  const verifyText = `RoadWatch Evidence Bundle\n\nIncluded SHA-256 hashes are in manifest.json.\n\nVerification (example):\n- Compute SHA-256 of each file and compare to manifest.json\n- For each Fabric txid in blockchain/receipts.json:\n  - Retrieve the transaction + block header from your Fabric peer (peer CLI / gateway SDK)\n  - Preserve endorsements / certificate chains as produced by the peer\n\nNote: This bundle is not legal advice. Consult local counsel for admissibility requirements.\n`;

  manifest.files.push({ name: 'VERIFY.txt', sha256: sha256Text(verifyText), mime: 'text/plain' });

  // Stream ZIP
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="rti-evidence-${params.id}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    // Avoid throwing after headers have been sent.
    console.error('[rti evidence] zip error', err);
    try {
      res.status(500).end();
    } catch {
      // ignore
    }
  });

  archive.pipe(res);

  for (const tf of textFiles) {
    archive.append(tf.text, { name: tf.name });
  }

  // Add binary files (response + attachments) with stable names.
  for (const file of responses.rows) {
    const ext = path.extname(String(file.file_path ?? ''));
    const name = `rti/responses/${file.id}${ext || ''}`;
    manifest.files.push({ name, sha256: file.file_sha256, mime: file.file_mime ?? null });
    archive.file(file.file_path, { name });
  }
  for (const file of attachments.rows) {
    const ext = path.extname(String(file.file_path ?? ''));
    const name = `rti/attachments/${file.kind.toLowerCase()}-${file.id}${ext || ''}`;
    manifest.files.push({ name, sha256: file.file_sha256, mime: file.file_mime ?? null });
    archive.file(file.file_path, { name });
  }

  const manifestText = JSON.stringify(manifest, null, 2);
  archive.append(manifestText, { name: 'manifest.json' });
  archive.append(verifyText, { name: 'VERIFY.txt' });

  await archive.finalize();
});

export default router;
