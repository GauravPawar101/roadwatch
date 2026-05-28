#!/usr/bin/env node
/*
  Simple data migration helper: Postgres -> Cassandra

  - Streams rows in batches from Postgres and inserts into Cassandra.
  - Intended as a starting point. Review and adapt for your schema and
    production data volumes before running.

  Requires environment variables:
    PG_CONNECTION_STRING (e.g. postgres://user:pass@host:5432/db)
    CASSANDRA_CONTACT_POINTS (comma-separated host:port)
    CASSANDRA_LOCAL_DC
    CASSANDRA_KEYSPACE

  Install dependencies locally before running:
    npm i pg cassandra-driver

  Run:
    node scripts/migrate-postgres-to-cassandra.js
*/

const { Client: PgClient } = require('pg');
const cassandra = require('cassandra-driver');

const BATCH_SIZE = 500;

async function migrateTable(pg, cassandraClient, table, selectSql, transformRow, insertCql, insertParamsFn) {
  console.log(`Migrating table: ${table}`);
  let offset = 0;
  while (true) {
    const res = await pg.query({ text: `${selectSql} LIMIT $1 OFFSET $2`, values: [BATCH_SIZE, offset] });
    if (!res.rows || res.rows.length === 0) break;
    for (const r of res.rows) {
      const row = transformRow(r);
      const params = insertParamsFn(row);
      try {
        await cassandraClient.execute(insertCql, params, { prepare: true });
      } catch (err) {
        console.error('Insert error, skipping row', err.message || err);
      }
    }
    offset += res.rows.length;
    console.log(`  migrated ${offset} rows...`);
    if (res.rows.length < BATCH_SIZE) break;
  }
}

async function main() {
  const pgConn = process.env.PG_CONNECTION_STRING;
  if (!pgConn) {
    console.error('Missing PG_CONNECTION_STRING env var');
    process.exit(2);
  }

  const pg = new PgClient({ connectionString: pgConn });
  await pg.connect();

  const contactPoints = (process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1:9042').split(',').map(s => s.trim());
  const localDC = process.env.CASSANDRA_LOCAL_DC || 'datacenter1';
  const keyspace = process.env.CASSANDRA_KEYSPACE || 'roadwatch';

  const cassandraClient = new cassandra.Client({ contactPoints, localDataCenter: localDC, keyspace });
  await cassandraClient.connect();

  try {
    // Users
    await migrateTable(pg, cassandraClient, 'users', 'SELECT id, email, phone, username, password_hash, signup_method, role, districts, zones, fabric_verified, created_at, updated_at FROM users',
      (r) => r,
      'INSERT INTO users (id, email, phone, username, password_hash, signup_method, role, districts, zones, fabric_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      (r) => [r.id, r.email || null, r.phone || null, r.username || null, r.password_hash || null, r.signup_method || null, r.role || null, r.districts || [], r.zones || [], r.fabric_verified || false, r.created_at || null, r.updated_at || null]
    );

    // Complaints
    await migrateTable(pg, cassandraClient, 'complaints', 'SELECT id, district, zone, status, description, lat, lng, created_at, updated_at, fabric_txid FROM complaints',
      (r) => r,
      'INSERT INTO complaints (id, district, zone, status, description, lat, lng, created_at, updated_at, fabric_txid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      (r) => [r.id, r.district || null, r.zone || null, r.status || null, r.description || null, r.lat || null, r.lng || null, r.created_at || null, r.updated_at || null, r.fabric_txid || null]
    );

    // Image submissions
    await migrateTable(pg, cassandraClient, 'image_submissions', 'SELECT id, request_id, uploader_id_encrypted, uploader_pseudonym, server_received_at, exif_timestamp, exif_lat AS exif_latitude, exif_lng AS exif_longitude, device_lat AS device_latitude, device_lng AS device_longitude, nonce, phash, verified_status, storage_path, metadata, created_by_id FROM image_submissions',
      (r) => r,
      'INSERT INTO image_submissions (id, request_id, uploader_id_encrypted, uploader_pseudonym, server_received_at, exif_timestamp, exif_latitude, exif_longitude, device_latitude, device_longitude, nonce, phash, verified_status, storage_path, metadata, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      (r) => [r.id, r.request_id || null, r.uploader_id_encrypted || null, r.uploader_pseudonym || null, r.server_received_at || null, r.exif_timestamp || null, r.exif_latitude || null, r.exif_longitude || null, r.device_latitude || null, r.device_longitude || null, r.nonce || null, r.phash || null, r.verified_status || null, r.storage_path || null, r.metadata ? JSON.stringify(r.metadata) : null, r.created_by_id || null]
    );

    // Audit log
    await migrateTable(pg, cassandraClient, 'audit_log', 'SELECT id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at FROM audit_log',
      (r) => r,
      'INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      (r) => [r.id, r.actor_user_id || null, r.actor_phone_hash || null, r.actor_phone_masked || null, r.action || null, r.target_type || null, r.target_id || null, r.details ? JSON.stringify(r.details) : null, r.created_at || null]
    );

    console.log('Migration complete.');
  } finally {
    await cassandraClient.shutdown();
    await pg.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
