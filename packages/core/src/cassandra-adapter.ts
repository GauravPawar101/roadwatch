import { Client, types } from 'cassandra-driver';

export class Pool {
  client: Client;

  constructor(_opts?: any) {
    const contactPoints = (process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1:9042')
      .split(',')
      .map((s) => s.trim());
    const localDataCenter = process.env.CASSANDRA_LOCAL_DC || 'datacenter1';
    const keyspace = process.env.CASSANDRA_KEYSPACE || 'roadwatch';

    this.client = new Client({ contactPoints, localDataCenter, keyspace });

    // Attempt to connect in background; callers should handle query errors explicitly
    this.client.connect().catch(() => {});
  }

  async query(_sql: string, _params?: any[]): Promise<any> {
    const sql = (_sql || '').trim();
    const upper = sql.toUpperCase();

    // Common health checks
    if (upper === 'SELECT 1' || upper.startsWith('SELECT 1;')) {
      const r = await this.client.execute('SELECT release_version FROM system.local', [], { prepare: true });
      return { rows: [{ release_version: r.rows[0]?.release_version ?? null }] } as any;
    }
    if (upper.startsWith('SELECT NOW') || upper.startsWith('SELECT NOW()')) {
      const r = await this.client.execute('SELECT now() FROM system.local', [], { prepare: true });
      return { rows: [{ now: r.rows[0]?.now ?? new Date() }] } as any;
    }

    // Reject Postgres-specific queries that cannot be auto-translated
    const blocked = ['RETURNING', 'ON CONFLICT', 'JSONB', 'ARRAY', 'ALTER TABLE', 'CREATE EXTENSION', 'FOREIGN KEY', 'CHECK'];
    for (const token of blocked) {
      if (upper.includes(token)) {
        throw new Error(`Unsupported Postgres SQL token in query: ${token}. Please migrate this query to Cassandra CQL. SQL: ${sql}`);
      }
    }

    // Naive parameter placeholder conversion: $1,$2 -> ? (preserves order)
    const converted = sql.replace(/\$\d+/g, '?');
    try {
      const res = await this.client.execute(converted, _params || [], { prepare: true });
      return { rows: res.rows } as any;
    } catch (err) {
      throw err;
    }
  }

  async end(): Promise<void> {
    try {
      await this.client.shutdown();
    } catch (err) {
      // ignore
    }
  }

  // expose cassandra types for callers that need TimeUuid
  static types = types;
}

export default Pool;
