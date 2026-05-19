import { Client, types } from 'cassandra-driver';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

const workspaceRoot = resolve(new URL(import.meta.url).pathname, '..', '..', '..', '..');
loadEnv({ path: resolve(workspaceRoot, 'apps/gateway-api/.env'), override: false });

const rawContactPoints = (process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1:9042').split(',').map(s => s.trim());
const localDataCenter = process.env.CASSANDRA_LOCAL_DC || 'datacenter1';
const keyspace = process.env.CASSANDRA_KEYSPACE || 'roadwatch';

// Support optional port in contact points (host:port). If provided, set protocolOptions.port.
let contactPoints: string[] = [];
let protocolPort: number | undefined;
for (const cp of rawContactPoints) {
  if (cp.includes(':')) {
    const parts = cp.split(':');
    const host = parts[0] || cp;
    contactPoints.push(host);
    const portStr = parts[1];
    const p = Number(portStr || NaN);
    if (!Number.isNaN(p)) protocolPort = p;
  } else {
    contactPoints.push(cp);
  }
}

const clientOptions: any = { contactPoints, localDataCenter, keyspace };
if (protocolPort) clientOptions.protocolOptions = { port: protocolPort };

export const client = new Client(clientOptions);

export const cassandraTypes = types;

export async function connect(): Promise<void> {
  try {
    await client.connect();
  } catch (err) {
    // Do not crash at import time; callers should handle connection errors.
    console.warn('[cassandra] connect warning:', err instanceof Error ? err.message : String(err));
  }
}

export async function shutdown(): Promise<void> {
  try {
    await client.shutdown();
  } catch (err) {
    console.warn('[cassandra] shutdown warning:', err instanceof Error ? err.message : String(err));
  }
}

export async function execute(cql: string, params?: any[], options?: { prepare?: boolean }) {
  return client.execute(cql, params, { prepare: options?.prepare ?? true });
}
