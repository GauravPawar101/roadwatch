import express from 'express';
import { z } from 'zod';
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
import { requireAuth, requireRole } from '../rbac.js';

const router = express.Router();

// Role assignment
router.post('/users', requireAuth, requireRole(['CE']), async (req, res) => {
  const body = z
    .object({
      phone: z.string().min(6),
      role: z.enum(['CE', 'EE']),
      govtId: z.string().min(1).optional(),
      districts: z.array(z.string()).optional().default([]),
      zones: z.array(z.string()).optional().default([])
    })
    .parse(req.body);

  const user = await upsertUser({
    phone: body.phone,
    role: body.role,
    govtId: body.govtId ?? null,
    districts: body.districts,
    zones: body.zones
  });

  res.json({
    user: {
      id: user.id,
      phone: user.phone,
      govtId: user.govtId,
      role: user.role,
      districts: user.districts,
      zones: user.zones
    }
  });
});

router.get('/users', requireAuth, requireRole(['CE']), async (req, res) => {
  const query = z
    .object({
      limit: z.coerce.number().int().positive().optional().default(500)
    })
    .parse(req.query);

  const users = await listUsers({ roles: ['CE', 'EE'], limit: query.limit });
  res.json({
    users: users.map((u) => ({
      id: u.id,
      phone: u.phone,
      govtId: u.govtId,
      role: u.role,
      districts: u.districts,
      zones: u.zones,
      createdAt: u.created_at
    }))
  });
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

  const contractor = await createContractor({
    companyName: body.companyName,
    registrationNumber: body.registrationNumber,
    contactPhoneMasked: body.contactPhoneMasked ?? null,
    districts: body.districts,
    zones: body.zones
  });

  res.json({ contractor });
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

  const country = await upsertCountry(body);
  res.json({ country });
});

router.post('/regions/states', requireAuth, requireRole(['CE']), async (req, res) => {
  const body = z
    .object({
      countryCode: z.string().min(2).max(3),
      code: z.string().min(1).max(8),
      name: z.string().min(2)
    })
    .parse(req.body);

  const state = await upsertState(body);
  res.json({ state });
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

  const district = await upsertDistrict(body);
  res.json({ district });
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

  const result = await bulkUpsertRoads({ districtId, roads: body.roads });
  res.json({ result });
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

  const assignment = await createRoadAssignment({
    roadId: params.roadId,
    contractorId: body.contractorId ?? null,
    engineerUserId: body.engineerUserId ?? null,
    startsOn: body.startsOn ?? null,
    endsOn: body.endsOn ?? null
  });
  res.json({ assignment });
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

  const authority = await upsertAuthorityDirectory({
    authorityId: params.authorityId,
    name: body.name,
    department: body.department ?? null,
    publicPhone: body.publicPhone ?? null,
    publicEmail: body.publicEmail ?? null,
    website: body.website ?? null,
    address: body.address ?? null
  });

  res.json({ authority });
});

export default router;
