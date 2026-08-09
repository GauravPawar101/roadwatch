# Database

PostgreSQL is the canonical data store for RoadWatch.

## Connection

### Applications (via PgBouncer)

```
postgresql://postgres:postgres@127.0.0.1:16432/roadwatch
```

PgBouncer runs in transaction pooling mode with up to 400 client connections and 50 pool size.

### Direct access (debugging)

```
postgresql://postgres:postgres@127.0.0.1:15433/roadwatch
```

Bypass PgBouncer for migrations, debugging, or `psql` sessions.

## Schema initialization

1. **Docker init**: `docker/postgres/init.sql` runs on first Postgres container start via `docker-entrypoint-initdb.d`.
2. **Runtime migrations**: Gateway `initDb()` applies SQL from `packages/core/migrations/*.sql` on startup.

There is no separate `db:migrate` CLI command.

## Key tables

See [Data model](../architecture/data-model.md) for the full entity reference.

| Domain | Tables |
|--------|--------|
| Auth | `users`, `sessions`, `otp_requests` |
| Geography | `states`, `districts`, `roads`, `road_authorities` |
| Complaints | `complaints`, `complaint_events`, `complaint_assignments`, `complaint_media`, `complaint_anchors` |
| Events | `kafka_event_outbox` |
| RTI | `rti_requests`, `rti_responses`, `rti_deadlines` |
| Analytics | `citizen_karma`, `chronic_roads`, `analytics_snapshots` |
| Notifications | `notifications`, `notification_preferences` |
| Audit | `audit_log` |

## Seeding

```powershell
pnpm seed:demo       # Full demo dataset (users, roads, complaints)
pnpm seed:backend    # Backend-specific seed
```

Demo data script: `apps/gateway-api/scripts/seed-demo-data.ts`

Deterministic test IDs: `scripts/test-ids.env`

## Backup and restore

### Backup

```powershell
docker exec roadwatch_postgres pg_dump -U postgres roadwatch > backup.sql
```

### Restore

```powershell
docker exec -i roadwatch_postgres psql -U postgres roadwatch < backup.sql
```

## Production considerations

- Use managed Postgres (RDS, Cloud SQL) in production.
- Enable connection pooling via PgBouncer or built-in pooler.
- Set `PHONE_HASH_PEPPER` and `PHONE_ENC_KEY` for PII protection.
- Regular backups with point-in-time recovery.

## Related docs

- [Data model](../architecture/data-model.md)
- [Docker Compose](./docker-compose.md)
- [Seeding and onboarding](../operations/seeding-and-onboarding.md)
