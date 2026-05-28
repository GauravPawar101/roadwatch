Migration helper: Postgres -> Cassandra (legacy)

Overview
--------
This folder contains a simple, idempotent helper script to copy data from
Postgres tables into Cassandra tables for legacy migration only
experiments. It is NOT a production-grade migration tool — review and test
carefully before using on large datasets.

Prerequisites
-------------
- Node.js installed
- Set environment variables or use a tool like `direnv`/`.env` file:
  - `PG_CONNECTION_STRING` — Postgres connection string
  - `CASSANDRA_CONTACT_POINTS` — comma-separated list (e.g. `cassandra:9042`) for this legacy migration helper
  - `CASSANDRA_LOCAL_DC` — local dc (default: `datacenter1`)
  - `CASSANDRA_KEYSPACE` — keyspace name (default: `roadwatch`)

Install
-------
From repository root:

```bash
npm install pg cassandra-driver
```

Run
---

```bash
node scripts/migrate-postgres-to-cassandra.js
```

Notes
-----
- The script migrates a small set of tables as an example (`users`,
  `complaints`, `image_submissions`, `audit_log`). Add or modify sections
  for other tables and complex transformations as needed.
- For large datasets, consider streaming exports and bulk-loading tools.
- Always backup your source DB before running migrations.
