Postgres -> Cassandra Migration Tool

This small tool migrates rows from Postgres tables into Cassandra using
per-table mappings.

Usage
-----
Set environment variables (example):

```bash
export PG_CONNECTION_STRING="postgres://user:pass@host:5432/db"
export CASSANDRA_CONTACT_POINTS=cassandra:9042
export CASSANDRA_LOCAL_DC=datacenter1
export CASSANDRA_KEYSPACE=roadwatch
```

Run full migration:

```bash
node scripts/migrate/index.js
```

Dry-run (no inserts):

```bash
node scripts/migrate/index.js --dry-run
```

Migrate only specific tables:

```bash
node scripts/migrate/index.js --tables users,complaints
```

Notes
-----
- This tool is intended as a starting point. Review and adapt `mappings.js` to
  adjust selects, transforms and insert statements to your actual schemas.
- For large datasets prefer using streaming/`COPY` and bulk-loading patterns.
- Always backup your source data before migrating.
