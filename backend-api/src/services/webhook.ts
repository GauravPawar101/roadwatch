import express from 'express';
import { z } from 'zod';
import { pool } from '@roadwatch/core';

const router = express.Router();

// POST /webhook/fabric-state-change
router.post('/fabric-state-change', async (req, res) => {
  try {
    const body = z
      .object({
        complaintId: z.string().min(1),
        eventType: z.enum(['complaint-submitted', 'complaint-anchored', 'complaint-status-changed']).optional(),
        type: z.enum(['complaint-submitted', 'complaint-anchored', 'complaint-status-changed']).optional(),
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

    const eventType = body.eventType ?? body.type ?? 'complaint-anchored';
    const fabricTxId = body.fabricTxId ?? body.txHash ?? null;
    const complaintMetadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : null;
    const roadId = typeof complaintMetadata?.roadId === 'string'
      ? complaintMetadata.roadId
      : typeof complaintMetadata?.road_id === 'string'
        ? complaintMetadata.road_id
        : null;

    const existing = await pool.query(
      'SELECT id, status FROM complaints WHERE id = $1 LIMIT 1',
      [body.complaintId]
    );

    if (existing.rows.length === 0) {
      if (eventType !== 'complaint-submitted') {
        return res.status(404).json({ error: 'Complaint not found' });
      }

      if (!body.district || !body.zone || !body.description) {
        return res.status(400).json({ error: 'Missing complaint fields for submission event' });
      }

      await pool.query(
        `INSERT INTO complaints (id, district, zone, status, description, lat, lng, road_id, report_count, metadata, fabric_txid, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          body.complaintId,
          body.district,
          body.zone,
          'FILED',
          body.description,
          body.lat ?? null,
          body.lng ?? null,
          roadId,
          body.reportCount ?? 1,
          JSON.stringify({
            ...(complaintMetadata ?? {}),
            roadId,
            damageType: complaintMetadata?.damageType ?? null,
            severity: complaintMetadata?.severity ?? null
          }),
          fabricTxId
        ]
      );
    } else {
        if (eventType === 'complaint-anchored' && fabricTxId) {
          await pool.query(
            `UPDATE complaints
            SET fabric_txid      = $1,
                anchored_tx_hash = $1,
                anchored_at      = NOW(),
                updated_at       = NOW()
            WHERE id = $2`,
            [fabricTxId, body.complaintId]
          );
        }

      if (eventType === 'complaint-status-changed' && body.newStatus) {
        await pool.query(
          'UPDATE complaints SET status = $1, updated_at = NOW() WHERE id = $2',
          [body.newStatus, body.complaintId]
        );
      }

      if (eventType === 'complaint-submitted' && fabricTxId) {
        await pool.query(
          'UPDATE complaints SET fabric_txid = $1, updated_at = NOW() WHERE id = $2',
          [fabricTxId, body.complaintId]
        );
      }
    }

    await pool.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
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
        })
      ]
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