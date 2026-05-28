import crypto from 'crypto';
import type express from 'express';
import { pool } from './postgres.js';

type StoredResult = {
  request_hash: string;
  response_code: number | null;
  response_body: unknown;
  updated_at: string;
};

export type IdempotencyClaim = {
  scope: string;
  key: string;
  requestHash: string;
};

export type IdempotencyReplay = {
  replay: true;
  statusCode: number;
  body: unknown;
};

let ensureTablePromise: Promise<void> | null = null;

function stable(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(',')}}`;
}

async function ensureIdempotencyTable(): Promise<void> {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      // DDL centralized in docker/postgres/init.sql; skip runtime idempotency table creation.
      console.info('Skipping runtime creation of api_idempotency_keys; ensure docker/postgres/init.sql has been applied');
    })();
  }

  await ensureTablePromise;
}

export function deriveIdempotencyKey(req: express.Request, scope: string): string {
  const explicit = req.header('idempotency-key')?.trim();
  if (explicit) return explicit;

  const fingerprint = [
    scope,
    req.method,
    req.path,
    stable(req.query ?? {}),
    stable(req.params ?? {}),
    stable(req.body ?? {}),
    typeof req.query?.token === 'string' ? req.query.token : ''
  ].join('|');

  return `auto:${crypto.createHash('sha256').update(fingerprint).digest('hex')}`;
}

export async function claimIdempotency(
  scope: string,
  idempotencyKey: string,
  requestHash: string
): Promise<IdempotencyClaim | IdempotencyReplay> {
  await ensureIdempotencyTable();

  const insertResult = await pool.query(
    `INSERT INTO api_idempotency_keys (scope, idempotency_key, request_hash, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (scope, idempotency_key) DO NOTHING`,
    [scope, idempotencyKey, requestHash]
  );

  const existing = await pool.query<StoredResult>(
    `SELECT request_hash, response_code, response_body, updated_at
     FROM api_idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2
     LIMIT 1`,
    [scope, idempotencyKey]
  );

  const row = existing.rows[0];
  if (!row) {
    throw new Error('Failed to claim idempotency key');
  }

  if (row.request_hash !== requestHash) {
    return {
      replay: true,
      statusCode: 409,
      body: { error: 'Idempotency key reuse with different request payload' }
    };
  }

  if (row.response_code !== null && row.response_body !== null) {
    return {
      replay: true,
      statusCode: row.response_code,
      body: row.response_body
    };
  }

  if (insertResult.rowCount === 0) {
    return {
      replay: true,
      statusCode: 409,
      body: { error: 'A request with this idempotency key is already being processed' }
    };
  }

  return { scope, key: idempotencyKey, requestHash };
}

export async function storeIdempotencyResult(
  claim: IdempotencyClaim,
  responseCode: number,
  body: unknown
): Promise<void> {
  await ensureIdempotencyTable();

  await pool.query(
    `UPDATE api_idempotency_keys
     SET response_code = $1,
         response_body = $2::jsonb,
         updated_at = NOW()
     WHERE scope = $3 AND idempotency_key = $4`,
    [responseCode, JSON.stringify(body), claim.scope, claim.key]
  );
}

export function buildRequestHash(payload: unknown): string {
  return crypto.createHash('sha256').update(stable(payload)).digest('hex');
}
