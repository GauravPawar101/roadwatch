import archiver from 'archiver';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { buildRequestHash, claimIdempotency, deriveIdempotencyKey, storeIdempotencyResult, type IdempotencyClaim } from '../idempotency.js';
import { calculateRtiDeadlines } from '../legal/rtiDeadlines.js';
import { pool, sql } from '../postgres.js'; // Imported standard sql tagged template factory

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
  const recordsRes = await pool.query(
    'SELECT id FROM rti_requests WHERE id = $1 AND tracking_token = $2',
    [rtiId, token]
  );
  const records = recordsRes.rows;
  if (records.length === 0) {
    const err = new Error('Invalid token');
    (err as any).statusCode = 403;
    throw err;
  }
}

async function claimRtiIdempotency(req: express.Request, scope: string, payload: unknown): Promise<IdempotencyClaim | { replay: true; statusCode: number; body: unknown }> {
  const key = deriveIdempotencyKey(req, scope);
  const requestHash = buildRequestHash(payload);
  return claimIdempotency(scope, key, requestHash);
}

// Multer storage configuration
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

// Create an RTI request
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

  const claimed = await claimRtiIdempotency(req, 'rti:create', body);
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

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
  const rtiId = `RTI-${crypto.randomUUID()}`;

  // Execute queries natively using standard transaction blocks if coupled
  await sql.begin(async (tx: any) => {
    await tx`
      INSERT INTO rti_requests (
        id, complaint_id, country_code, authority_name, subject, request_text, 
        status, submitted_at, response_due_at, first_appeal_last_date, 
        second_appeal_last_date, tracking_token, created_at, updated_at
      ) VALUES (
        ${rtiId}, ${body.complaintId ?? null}, ${body.countryCode.toUpperCase()}, ${body.authorityName}, 
        ${body.subject}, ${body.requestText}, ${body.status}, ${submittedAt}, 
        ${deadlines?.responseDueAt ?? null}, ${deadlines?.firstAppealLastDate ?? null}, 
        ${deadlines?.secondAppealLastDate ?? null}, ${trackingToken}, ${new Date()}, ${new Date()}
      )
    `;

    await tx`
      INSERT INTO rti_events (rti_id, type, properties, occurred_at) 
      VALUES (
        ${rtiId}, 
        ${body.status === 'FILED' ? 'RTI_FILED' : 'RTI_DRAFT_CREATED'}, 
        ${JSON.stringify({ basis: deadlines?.basis ?? null })}, 
        ${new Date()}
      )
    `;
  });

  const responseBody = {
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
  };

  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

// Update a draft before filing
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

  const claimed = await claimRtiIdempotency(req, 'rti:draft:update', { id: params.id, token, body });
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const existingRes = await pool.query(
    'SELECT status, authority_name, subject, request_text, complaint_id FROM rti_requests WHERE id = $1 LIMIT 1',
    [params.id]
  );
  const [existing] = existingRes.rows;
  
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.status !== 'DRAFT') return res.status(409).json({ error: 'Only DRAFT RTIs can be edited' });

  // Map application dynamic keys explicitly to database snake_case columns
  const updates: Record<string, any> = {};
  if (body.authorityName !== undefined) updates.authority_name = body.authorityName;
  if (body.subject !== undefined) updates.subject = body.subject;
  if (body.requestText !== undefined) updates.request_text = body.requestText;
  if (body.complaintId !== undefined) updates.complaint_id = body.complaintId;
  updates.updated_at = new Date();

  await sql.begin(async (tx: any) => {
    await tx`
      UPDATE rti_requests 
      SET ${tx(updates, Object.keys(updates))} 
      WHERE id = ${params.id}
    `;

    await tx`
      INSERT INTO rti_events (rti_id, type, properties, occurred_at) 
      VALUES (${params.id}, 'RTI_DRAFT_UPDATED', ${JSON.stringify({ updated: Object.keys(body) })}, ${new Date()})
    `;
  });

  const responseBody = { ok: true };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

// File/submit a draft
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

  const claimed = await claimRtiIdempotency(req, 'rti:file', { id: params.id, token, body });
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const existingRes = await pool.query(
    'SELECT id, status, country_code, submitted_at FROM rti_requests WHERE id = $1 LIMIT 1',
    [params.id]
  );
  const [existing] = existingRes.rows;
  if (!existing) return res.status(404).json({ error: 'Not found' });

  if (existing.status !== 'DRAFT') {
    const rowRes = await pool.query('SELECT * FROM rti_requests WHERE id = $1', [params.id]);
    const [row] = rowRes.rows;
    const responseBody = { ok: true, rti: row };
    await storeIdempotencyResult(claimed, 200, responseBody);
    return res.json(responseBody);
  }

  const submittedAt = body.submittedAt ? new Date(body.submittedAt) : new Date();
  const deadlines = calculateRtiDeadlines({
    countryCode: String(existing.country_code),
    submittedAt,
    isLifeOrLiberty: body.isLifeOrLiberty
  });

  let row;
  await sql.begin(async (tx: any) => {
    await tx`
      UPDATE rti_requests 
      SET status = 'FILED', submitted_at = ${submittedAt}, response_due_at = ${deadlines.responseDueAt}, 
          first_appeal_last_date = ${deadlines.firstAppealLastDate}, second_appeal_last_date = ${deadlines.secondAppealLastDate ?? null}, 
          updated_at = ${new Date()} 
      WHERE id = ${params.id}
    `;

    await tx`
      INSERT INTO rti_events (rti_id, type, properties, occurred_at) 
      VALUES (${params.id}, 'RTI_FILED', ${JSON.stringify({ basis: deadlines.basis })}, ${new Date()})
    `;

    [row] = await tx`SELECT * FROM rti_requests WHERE id = ${params.id}`;
  });

  const responseBody = { ok: true, rti: row, deadlines: { ...deadlines } };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

// Get RTI details
router.get('/:id', async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  // Run independent database fetches concurrently using Promise.all
  const [rtiRowsRes, responseRowsRes, attachmentRowsRes, eventRowsRes] = await Promise.all([
    pool.query('SELECT * FROM rti_requests WHERE id = $1 LIMIT 1', [params.id]),
    pool.query(
      'SELECT id, received_at, file_mime, file_sha256, notes, created_at FROM rti_responses WHERE rti_id = $1 ORDER BY created_at DESC',
      [params.id]
    ),
    pool.query(
      'SELECT id, kind, file_mime, file_sha256, note, created_at FROM rti_attachments WHERE rti_id = $1 ORDER BY created_at DESC',
      [params.id]
    ),
    pool.query('SELECT id, type, occurred_at, properties FROM rti_events WHERE rti_id = $1 ORDER BY occurred_at ASC', [params.id])
  ]);

  const rtiRows = rtiRowsRes.rows;
  const responseRows = responseRowsRes.rows;
  const attachmentRows = attachmentRowsRes.rows;
  const eventRows = eventRowsRes.rows;

  if (rtiRows.length === 0) return res.status(404).json({ error: 'Not found' });

  res.json({ 
    rti: rtiRows[0], 
    responses: responseRows, 
    attachments: attachmentRows, 
    events: eventRows 
  });
});

// Update RTI generic workflow status
router.post('/:id/status', async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  const body = z
    .object({
      status: z.enum(['ACKNOWLEDGED', 'RESPONDED', 'APPEALED', 'CLOSED'])
    })
    .parse(req.body);

  const claimed = await claimRtiIdempotency(req, 'rti:status:update', { id: params.id, token, body });
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  await sql.begin(async (tx: any) => {
    await tx`UPDATE rti_requests SET status = ${body.status}, updated_at = ${new Date()} WHERE id = ${params.id}`;
    await tx`INSERT INTO rti_events (rti_id, type, properties, occurred_at) VALUES (${params.id}, ${`RTI_${body.status}`}, ${JSON.stringify({})}, ${new Date()})`;
  });

  const responseBody = { ok: true };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

// Add response package
router.post('/:id/response', upload.single('response'), async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  if (!req.file) return res.status(400).json({ error: 'Missing response file' });

  const notes = typeof req.body?.notes === 'string' ? req.body.notes : null;
  const claimed = await claimRtiIdempotency(req, 'rti:response:add', {
    id: params.id,
    token,
    notes,
    originalName: req.file.originalname,
    mime: req.file.mimetype,
    size: req.file.size
  });
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const fileSha = await sha256File(req.file.path);

  await sql.begin(async (tx: any) => {
    await tx`
      INSERT INTO rti_responses (id, rti_id, file_path, file_mime, file_sha256, notes, received_at, created_at) 
      VALUES (${crypto.randomUUID()}, ${params.id}, ${req.file!.path}, ${req.file!.mimetype ?? null}, ${fileSha}, ${notes}, ${new Date()}, ${new Date()})
    `;
    await tx`UPDATE rti_requests SET status = 'RESPONDED', updated_at = ${new Date()} WHERE id = ${params.id}`;
    await tx`INSERT INTO rti_events (rti_id, type, properties, occurred_at) VALUES (${params.id}, 'RTI_RESPONSE_UPLOADED', ${JSON.stringify({ fileSha256: fileSha, mime: req.file!.mimetype ?? null })}, ${new Date()})`;
  });

  const responseBody = { ok: true, fileSha256: fileSha };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

// Attach general documentation assets
router.post('/:id/attachments', upload.array('files', 10), async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  const kind = z.enum(['PHOTO', 'VIDEO', 'DOCUMENT']).parse(req.body?.kind);
  const note = typeof req.body?.note === 'string' ? req.body.note : null;

  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) return res.status(400).json({ error: 'Missing files' });

  const claimed = await claimRtiIdempotency(req, 'rti:attachments:add', {
    id: params.id,
    token,
    kind,
    note,
    files: files.map((f) => ({ name: f.originalname, mime: f.mimetype, size: f.size }))
  });
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const saved: Array<{ sha256: string; mime: string | null }> = [];

  await sql.begin(async (tx: any) => {
    for (const file of files) {
      const fileSha = await sha256File(file.path);
      await tx`
        INSERT INTO rti_attachments (id, rti_id, kind, file_path, file_mime, file_sha256, note, created_at) 
        VALUES (${crypto.randomUUID()}, ${params.id}, ${kind}, ${file.path}, ${file.mimetype ?? null}, ${fileSha}, ${note}, ${new Date()})
      `;
      saved.push({ sha256: fileSha, mime: file.mimetype ?? null });
    }

    await tx`
      INSERT INTO rti_events (rti_id, type, properties, occurred_at) 
      VALUES (${params.id}, 'RTI_ATTACHMENTS_ADDED', ${JSON.stringify({ count: files.length, kind })}, ${new Date()})
    `;
  });

  const responseBody = { ok: true, files: saved };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

// Public escalation setup
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

  const claimed = await claimRtiIdempotency(req, 'rti:escalate', { id: params.id, token, body });
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const shareToken = body.makePublic ? crypto.randomUUID() : null;

  let shareToSet = null;
  await sql.begin(async (tx: any) => {
    const [cur] = await tx`SELECT public_share_token FROM rti_requests WHERE id = ${params.id} LIMIT 1`;
    const existingShare = cur ? cur.public_share_token : null;
    shareToSet = existingShare ?? shareToken;

    await tx`
      UPDATE rti_requests 
      SET public_opt_in_at = ${new Date()}, public_share_token = ${shareToSet}, updated_at = ${new Date()} 
      WHERE id = ${params.id}
    `;

    await tx`
      INSERT INTO rti_events (rti_id, type, properties, occurred_at) 
      VALUES (${params.id}, 'RTI_ESCALATED', ${JSON.stringify({ channel: body.channel, makePublic: body.makePublic })}, ${new Date()})
    `;
  });

  const responseBody = {
    ok: true,
    publicShareToken: body.makePublic ? shareToSet : null,
    publicUrl: body.makePublic && shareToSet ? `/public/rti/${shareToSet}` : null
  };

  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

// Zip compilation service
router.get('/:id/evidence.zip', async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = mustToken(req);
  await assertTokenAccess(params.id, token);

  const rtiRowRes = await pool.query('SELECT * FROM rti_requests WHERE id = $1 LIMIT 1', [params.id]);
  const [rtiRow] = rtiRowRes.rows;
  if (!rtiRow) return res.status(404).json({ error: 'Not found' });

  const [eventsRes, responsesRes, attachmentsRes] = await Promise.all([
    pool.query('SELECT id, type, occurred_at, properties FROM rti_events WHERE rti_id = $1', [params.id]),
    pool.query(
      'SELECT id, received_at, file_path, file_mime, file_sha256, notes, created_at FROM rti_responses WHERE rti_id = $1',
      [params.id]
    ),
    pool.query(
      'SELECT id, kind, file_path, file_mime, file_sha256, note, created_at FROM rti_attachments WHERE rti_id = $1',
      [params.id]
    )
  ]);

  const events = eventsRes.rows;
  const responses = responsesRes.rows;
  const attachments = attachmentsRes.rows;

  const linkedComplaintId = rtiRow.complaint_id as string | null;
  
  let complaintRow = null;
  let auditRows: any[] = [];

  if (linkedComplaintId) {
    const complaintRes = await pool.query('SELECT * FROM complaints WHERE id = $1 LIMIT 1', [linkedComplaintId]);
    const [complaint] = complaintRes.rows;
    complaintRow = complaint ?? null;
    const auditRes = await pool.query(
      "SELECT id, action, target_type, target_id, details, fabric_txid, created_at FROM audit_log WHERE target_type = 'COMPLAINT' AND target_id = $1",
      [linkedComplaintId]
    );
    auditRows = auditRes.rows;
  }

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

  const rtiJsonText = JSON.stringify(rtiRow, null, 2);
  const eventsJsonText = JSON.stringify(events, null, 2);
  const responsesJsonText = JSON.stringify(responses.map((x: any) => ({ ...x, file_path: undefined })), null, 2);
  const attachmentsJsonText = JSON.stringify(attachments.map((x: any) => ({ ...x, file_path: undefined })), null, 2);
  const complaintJsonText = JSON.stringify(complaintRow, null, 2);
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

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="rti-evidence-${params.id}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('[rti evidence] zip error', err);
    try { res.status(500).end(); } catch {}
  });

  archive.pipe(res);

  for (const tf of textFiles) {
    archive.append(tf.text, { name: tf.name });
  }

  for (const file of responses) {
    const ext = path.extname(String(file.file_path ?? ''));
    const name = `rti/responses/${file.id}${ext || ''}`;
    manifest.files.push({ name, sha256: file.file_sha256, mime: file.file_mime ?? null });
    archive.file(file.file_path, { name });
  }

  for (const file of attachments) {
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