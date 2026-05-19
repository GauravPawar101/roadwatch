import express from 'express';
import { z } from 'zod';
import { execute } from '../../../apps/gateway-api/src/cassandra.js';

const router = express.Router();

// POST /webhook/fabric-state-change
router.post('/fabric-state-change', async (req, res) => {
  try {
    const body = z
      .object({
        complaintId: z.string().min(1),
        eventType: z.enum(['complaint.submitted', 'complaint.anchored', 'complaint.status.changed']).optional(),
        type: z.enum(['complaint.submitted', 'complaint.anchored', 'complaint.status.changed']).optional(),
        fabricTxId: z.string().min(1).optional(),
        txHash: z.string().min(1).optional(),
        newStatus: z.string().min(1).optional(),
        previousStatus: z.string().min(1).optional(),
        district: z.string().min(1).optional(),
        zone: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        lat: z.coerce.number().optional(),
        lng: z.coerce.number().optional(),
        reportCount: z.coerce.number().int().positive().optional(),
        metadata: z.record(z.unknown()).optional(),
        occurredAt: z.string().datetime().optional()
      })
      .parse(req.body);

    const eventType = body.eventType ?? body.type ?? 'complaint.anchored';
    const fabricTxId = body.fabricTxId ?? body.txHash ?? null;

    // Cassandra: perform idempotent upserts without SQL transactions
    const existing = await execute('SELECT id, status FROM complaints WHERE id = ? LIMIT 1', [body.complaintId], { prepare: true });

    if (!existing || (existing.rows || []).length === 0) {
      if (eventType !== 'complaint.submitted') {
        return res.status(404).json({ error: 'Complaint not found' });
      }

      if (!body.district || !body.zone || !body.description) {
        return res.status(400).json({ error: 'Missing complaint fields for submission event' });
      }

      await execute(
        `INSERT INTO complaints (id, district, zone, status, description, lat, lng, report_count, fabric_txid, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          body.complaintId,
          body.district,
          body.zone,
          'FILED',
          body.description,
          body.lat ?? null,
          body.lng ?? null,
          body.reportCount ?? 1,
          fabricTxId,
          new Date()
        ],
        { prepare: true }
      );
    } else {
      if (eventType === 'complaint.anchored' && fabricTxId) {
        await execute('UPDATE complaints SET fabric_txid = ?, updated_at = ? WHERE id = ?', [fabricTxId, new Date(), body.complaintId], { prepare: true });
      }

      if (eventType === 'complaint.status.changed' && body.newStatus) {
        await execute('UPDATE complaints SET status = ?, updated_at = ? WHERE id = ?', [body.newStatus, new Date(), body.complaintId], { prepare: true });
      }

      if (eventType === 'complaint.submitted' && fabricTxId) {
        await execute('UPDATE complaints SET fabric_txid = ?, updated_at = ? WHERE id = ?', [fabricTxId, new Date(), body.complaintId], { prepare: true });
      }
    }

    await execute(
      `INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        null,
        null,
        null,
        eventType.toUpperCase().replace(/\./g, '_'),
        'complaint',
        body.complaintId,
        JSON.stringify({
          eventType,
          fabricTxId,
          newStatus: body.newStatus ?? null,
          previousStatus: body.previousStatus ?? null,
          metadata: body.metadata ?? null,
          occurredAt: body.occurredAt ?? null
        }),
        new Date()
      ],
      { prepare: true }
    );

    return res.json({ ok: true, complaintId: body.complaintId, eventType, fabricTxId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid webhook payload', details: error.flatten() });
    }

    console.error('Error processing fabric state change webhook:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
