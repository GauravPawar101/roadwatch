import express from 'express';
import { z } from 'zod';
import { registerFabricIdentity, verifyFabricIdentity } from '../auth/fabric.js';
import {
    bulkUpsertRoads,
    createContractor,
    createRoadAssignment,
    listUsers,
    upsertAuthorityDirectory,
    upsertCountry,
    upsertDistrict,
    upsertState,
    upsertUser
} from '../db.js';
import { buildRequestHash, claimIdempotency, deriveIdempotencyKey, storeIdempotencyResult, type IdempotencyClaim } from '../idempotency.js';
import { pool } from '../postgres.js';
import { requireAuth, requireRole } from '../rbac.js';
import { uuidv7 } from '../uuid.js';

const router = express.Router();

async function claimAdminIdempotency(
  req: express.Request,
  scope: string,
  payload: unknown
): Promise<IdempotencyClaim | { replay: true; statusCode: number; body: unknown }> {
  const key = deriveIdempotencyKey(req, scope);
  const requestHash = buildRequestHash(payload);
  return claimIdempotency(scope, key, requestHash);
}

// Role assignment
router.post('/users', requireAuth, requireRole(['CE']), async (req, res) => {
  const body = z
    .object({
      phone: z.string().min(6),
      username: z.string().min(3).optional(),
      role: z.enum(['CE', 'EE', 'CONTRACTOR']),
      govtId: z.string().min(1).optional(),
      districts: z.array(z.string()).optional().default([]),
      zones: z.array(z.string()).optional().default([])
    })
    .parse(req.body);

  const claimed = await claimAdminIdempotency(req, 'admin:users:create', body);
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const user = await upsertUser({
    phone: body.phone,
    username: body.username ?? null,
    role: body.role,
    govtId: body.govtId ?? null,
    districts: body.districts,
    zones: body.zones
  });

  const responseBody = {
    user: {
      id: user.id,
      username: user.username,
      phone: user.phone,
      govtId: user.govtId,
      role: user.role,
      districts: user.districts,
      zones: user.zones
    }
  };

  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

router.post('/fabric-identities/seed', requireAuth, requireRole(['CE']), async (req, res) => {
  const body = z
    .object({
      identities: z
        .array(
          z.object({
            userId: z.string().min(1),
            role: z.enum(['CE', 'EE', 'CONTRACTOR']),
            orgName: z.string().min(1),
            certPem: z.string().min(1),
            mspId: z.string().min(1)
          })
        )
        .min(1)
    })
    .parse(req.body);

  const seeded: Array<{ userId: string; role: 'CE' | 'EE' | 'CONTRACTOR'; fabricIdentityId: string; verified: boolean }> = [];

  for (const identity of body.identities) {
    const registered = await registerFabricIdentity(identity);
    const verified = await verifyFabricIdentity({ userId: identity.userId, role: identity.role, certPem: identity.certPem });

    seeded.push({
      userId: identity.userId,
      role: identity.role,
      fabricIdentityId: registered.id,
      verified
    });
  }

  res.json({ ok: true, seeded });
});

router.get('/users', requireAuth, requireRole(['CE']), async (req, res) => {
  const query = z
    .object({
      limit: z.coerce.number().int().positive().optional().default(500)
    })
    .parse(req.query);

  const users = await listUsers({ roles: ['CE', 'EE', 'CONTRACTOR'], limit: query.limit });
  res.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      phone: u.phone,
      govtId: u.govtId,
      role: u.role,
        accountStatus: u.accountStatus,
      districts: u.districts,
      zones: u.zones,
      createdAt: u.created_at
    }))
  });
});

router.post('/users/:userId/suspend', requireAuth, requireRole(['CE']), async (req, res) => {
  const params = z.object({ userId: z.string().uuid() }).parse(req.params);
  const body = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});

  await pool.query(
    `UPDATE users
     SET account_status = 'SUSPENDED',
         suspended_at = NOW(),
         suspension_reason = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [params.userId, body.reason ?? null]
  );

  await pool.query(
    `INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at)
     VALUES ($1, $2, NULL, NULL, 'USER_SUSPENDED', 'user', $3, $4::jsonb, NOW())`,
    [uuidv7(), (req as any).user?.sub ?? null, params.userId, JSON.stringify({ reason: body.reason ?? null })]
  );

  res.json({ ok: true });
});

router.post('/users/:userId/reactivate', requireAuth, requireRole(['CE']), async (req, res) => {
  const params = z.object({ userId: z.string().uuid() }).parse(req.params);

  await pool.query(
    `UPDATE users
     SET account_status = 'ACTIVE',
         suspended_at = NULL,
         suspension_reason = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [params.userId]
  );

  await pool.query(
    `INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at)
     VALUES ($1, $2, NULL, NULL, 'USER_REACTIVATED', 'user', $3, '{}'::jsonb, NOW())`,
    [uuidv7(), (req as any).user?.sub ?? null, params.userId]
  );

  res.json({ ok: true });
});

// Contractor onboarding
router.post('/contractors', requireAuth, requireRole(['CE']), async (req, res) => {
  const body = z
    .object({
      companyName: z.string().min(2),
      registrationNumber: z.string().min(2),
      contactPhoneMasked: z.string().min(4).optional(),
      districts: z.array(z.string()).optional().default([]),
      zones: z.array(z.string()).optional().default([])
    })
    .parse(req.body);

  const claimed = await claimAdminIdempotency(req, 'admin:contractors:create', body);
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const contractor = await createContractor({
    companyName: body.companyName,
    registrationNumber: body.registrationNumber,
    contactPhoneMasked: body.contactPhoneMasked ?? null,
    districts: body.districts,
    zones: body.zones
  });

  const responseBody = { contractor };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

// New country onboarding (region registry)
router.post('/regions/countries', requireAuth, requireRole(['CE']), async (req, res) => {
  const body = z
    .object({
      code: z.string().min(2).max(3),
      name: z.string().min(2),
      defaultTimeZone: z.string().min(3)
    })
    .parse(req.body);

  const claimed = await claimAdminIdempotency(req, 'admin:regions:countries:upsert', body);
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const country = await upsertCountry(body);
  const responseBody = { country };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

router.post('/regions/states', requireAuth, requireRole(['CE']), async (req, res) => {
  const body = z
    .object({
      countryCode: z.string().min(2).max(3),
      code: z.string().min(1).max(8),
      name: z.string().min(2)
    })
    .parse(req.body);

  const claimed = await claimAdminIdempotency(req, 'admin:regions:states:upsert', body);
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const state = await upsertState(body);
  const responseBody = { state };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

router.post('/regions/districts', requireAuth, requireRole(['CE']), async (req, res) => {
  const body = z
    .object({
      countryCode: z.string().min(2).max(3),
      stateCode: z.string().min(1).max(8),
      code: z.string().min(1).max(16),
      name: z.string().min(2),
      bbox: z.object({
        topLeft: z.object({ lat: z.number(), lng: z.number() }),
        bottomRight: z.object({ lat: z.number(), lng: z.number() })
      }),
      zoom: z.object({ min: z.number().int().min(0).max(22), max: z.number().int().min(0).max(22) }).optional(),
      tileStyleUrl: z.string().url().optional().nullable()
    })
    .parse(req.body);

  const claimed = await claimAdminIdempotency(req, 'admin:regions:districts:upsert', body);
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const district = await upsertDistrict(body);
  const responseBody = { district };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

router.post('/regions/districts/:districtId/roads', requireAuth, requireRole(['CE']), async (req, res) => {
  const districtId = z.string().uuid().parse(req.params.districtId);

  const lineString = z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(2)
  });
  const multiLineString = z.object({
    type: z.literal('MultiLineString'),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(2)).min(1)
  });
  const roadGeometry = z.union([lineString, multiLineString]);

  const body = z
    .object({
      roads: z
        .array(
          z.object({
            id: z.string().min(2),
            name: z.string().min(2),
            roadType: z.string().min(1),
            authorityId: z.string().min(1),
            totalLengthKm: z.number().optional(),
            geometry: roadGeometry.optional()
          })
        )
        .default([])
    })
    .parse(req.body);

  const claimed = await claimAdminIdempotency(req, 'admin:regions:districts:roads:bulk-upsert', {
    districtId,
    roads: body.roads
  });
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const result = await bulkUpsertRoads({ districtId, roads: body.roads });
  const responseBody = { result };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

router.post('/roads/:roadId/assignments', requireAuth, requireRole(['CE']), async (req, res) => {
  const params = z.object({ roadId: z.string().min(2) }).parse(req.params);
  const body = z
    .object({
      contractorId: z.string().min(1).optional().nullable(),
      engineerUserId: z.string().uuid().optional().nullable(),
      startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable()
    })
    .parse(req.body);

  const claimed = await claimAdminIdempotency(req, 'admin:roads:assignments:create', {
    roadId: params.roadId,
    body
  });
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const assignment = await createRoadAssignment({
    roadId: params.roadId,
    contractorId: body.contractorId ?? null,
    engineerUserId: body.engineerUserId ?? null,
    startsOn: body.startsOn ?? null,
    endsOn: body.endsOn ?? null
  });
  const responseBody = { assignment };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

router.put('/authorities/:authorityId', requireAuth, requireRole(['CE']), async (req, res) => {
  const params = z.object({ authorityId: z.string().min(1) }).parse(req.params);
  const body = z
    .object({
      name: z.string().min(2),
      department: z.string().min(2).optional().nullable(),
      publicPhone: z.string().min(4).optional().nullable(),
      publicEmail: z.string().email().optional().nullable(),
      website: z.string().url().optional().nullable(),
      address: z.string().min(2).optional().nullable()
    })
    .parse(req.body);

  const claimed = await claimAdminIdempotency(req, 'admin:authorities:upsert', {
    authorityId: params.authorityId,
    body
  });
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const authority = await upsertAuthorityDirectory({
    authorityId: params.authorityId,
    name: body.name,
    department: body.department ?? null,
    publicPhone: body.publicPhone ?? null,
    publicEmail: body.publicEmail ?? null,
    website: body.website ?? null,
    address: body.address ?? null
  });

  const responseBody = { authority };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

export default router;