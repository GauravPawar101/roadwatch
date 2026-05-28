import express from 'express'
import { z } from 'zod'
import { createAndFanoutNotification } from '../notifications/service.js'
import { pool } from '../postgres.js'
import { uuidv7 } from '../uuid.js'

const router = express.Router()

// Simple shared-secret check for internal callers
function checkServiceToken(req: express.Request) {
  const token = req.header('x-service-token') || ''
  const expected = process.env.INTERNAL_SERVICE_TOKEN || process.env.SERVICE_TOKEN || ''
  return token && expected && token === expected
}

const audienceSchema = z.union([
  z.object({ kind: z.literal('user'), userId: z.string() }),
  z.object({ kind: z.literal('jurisdiction'), district: z.string(), zone: z.string().optional() }),
  z.object({ kind: z.literal('road'), roadId: z.string() })
])

const msgSchema = z.object({
  type: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.any()).optional(),
  audience: audienceSchema,
  critical: z.boolean().optional()
})

// Accept either { message: NotificationMessage } OR { recipient_role, type, title, body, data }
const recipientSchema = z.object({
  recipient_role: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.any()).optional()
})

router.post('/create', async (req, res) => {
  if (!checkServiceToken(req)) return res.status(401).json({ error: 'unauthorized' })
  try {
    // If payload contains recipient_role, handle role-based fanout here
    if (req.body && typeof req.body.recipient_role === 'string') {
      const p = recipientSchema.parse(req.body)
      // Insert notification row
      const { recipient_role, type, title, body, data } = p
      const nid = uuidv7()
      await pool.query(
        `INSERT INTO notifications (id, recipient_role, type, title, body, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [nid, recipient_role, type, title, body, JSON.stringify(data || {})]
      )
      // Resolve users by role mapping
      const roleMapLookup: Record<string, string[]> = {
        ALL_AUTHORITIES: ['CE', 'EE'],
        authority: ['CE', 'EE'],
        contractor: ['CONTRACTOR'],
        citizen: ['CITIZEN']
      }
      const targetRoles = roleMapLookup[recipient_role] || [recipient_role]
      const usersRes = await pool.query(`SELECT id FROM users WHERE role = ANY($1)`, [targetRoles])
      const userIds = usersRes.rows.map((r: any) => r.id)
      for (const uid of userIds) {
        await pool.query(`INSERT INTO notification_inbox (id, user_id, notification_id, created_at) VALUES ($1,$2,$3,NOW())`, [uuidv7(), uid, nid])
        await pool.query(`INSERT INTO notification_deliveries (id, user_id, notification_id, channel, created_at) VALUES ($1,$2,$3,$4,NOW())`, [uuidv7(), uid, nid, 'IN_APP'])
      }
      return res.json({ ok: true, notificationId: nid, userIds })
    }

    // Otherwise expect a Message payload
    const payload = msgSchema.parse(req.body)
    const result = await createAndFanoutNotification({ message: payload as any })
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

export default router
