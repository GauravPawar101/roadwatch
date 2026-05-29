import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { initDb } from './db.js';
import { pool } from './postgres.js';

const district = 'INT-DISTRICT-EXACT-1';
const zone = 'INT-ZONE-EXACT-1';
const contractorId = '11111111-1111-4111-8111-111111111111';
const complaintId = '22222222-2222-4222-8222-222222222222';
const expenditureIds = [
  '33333333-3333-4333-8333-333333333331',
  '33333333-3333-4333-8333-333333333332'
];

async function cleanupSeed(): Promise<void> {
  await pool.query('DELETE FROM budget_expenditures WHERE id = ANY($1::uuid[])', [expenditureIds]).catch(() => null);
  await pool.query('DELETE FROM complaint_assignments WHERE complaint_id = $1', [complaintId]).catch(() => null);
  await pool.query('DELETE FROM complaints WHERE id = $1', [complaintId]).catch(() => null);
  await pool.query('DELETE FROM contractors WHERE id = $1', [contractorId]).catch(() => null);
}

describe('proposals intelligence integration', () => {
  beforeAll(async () => {
    await initDb();
    await cleanupSeed();

    await pool.query(
      `INSERT INTO contractors (id, name, created_at)
       VALUES ($1, $2, now())`,
      [contractorId, 'Exact Build Co']
    );

    await pool.query(
      `INSERT INTO complaints (id, district, zone, status, title, damage_type, severity, description, created_at, updated_at)
       VALUES ($1, $2, $3, 'RESOLVED', $4, $5, $6, $7, now() - interval '8 days', now() - interval '1 day')`,
      [complaintId, district, zone, 'Road repair', 'POTHOLE', 3, 'Resolved complaint']
    );

    await pool.query(
      `INSERT INTO complaint_assignments (complaint_id, district, contractor_id, assigned_at, expected_resolution_days)
       VALUES ($1, $2, $3, now() - interval '9 days', 7)`,
      [complaintId, district, contractorId]
    );

    await pool.query(
      `INSERT INTO budget_expenditures (id, allocation_id, amount, description, contractor_id, "timestamp", district, zone)
       VALUES
         ($1, 'alloc-exact-1', 100000, 'transport', $2, now() - interval '1 day', $3, $4),
         ($5, 'alloc-exact-1', 2500000, 'asphalt purchase', $2, now(), $3, $4)`,
      [expenditureIds[0], contractorId, district, zone, expenditureIds[1]]
    );
  });

  afterAll(async () => {
    await cleanupSeed();
  });

    it('reads exact expenditure rows and surfaces anomaly signals through the HTTP route', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/public/proposals/intelligence')
      .query({
        district,
        zone,
        plannedLengthKm: '0.5',
        requestedBudgetINR: '3000000'
      });

    expect(response.status).toBe(200);
    expect(response.body.anomaly).toBeTruthy();
    expect(response.body.anomaly.signals).toEqual(
      expect.arrayContaining(['single_large_expense', 'daily_spend_threshold_exceeded', 'zscore_outlier'])
    );
    expect(response.body.anomaly.severity === 'none').toBe(false);
    expect(response.body.inflatedBudgetFlag).toBe(true);
  }, 15000);
});