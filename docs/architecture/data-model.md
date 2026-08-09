# Data Model

RoadWatch stores operational data in PostgreSQL. Fabric holds Merkle anchors and audit metadata.

## Core entities

### Users and auth

| Table | Purpose |
|-------|---------|
| `users` | All roles (citizen, EE, CE, contractor) |
| `sessions` | Refresh token tracking |
| `otp_requests` | OTP challenge state (also cached in Redis) |

Users authenticate via OTP (phone/email/username). JWT access tokens carry role and jurisdiction claims.

### Geography and roads

| Table | Purpose |
|-------|---------|
| `states` | Indian states |
| `districts` | Districts within states |
| `roads` | Road segments with geometry, authority assignment |
| `road_authorities` | NHAI/PWD/municipal jurisdiction mapping |

Road matching uses geospatial queries when a citizen files a complaint with GPS coordinates.

### Complaints

| Table | Purpose |
|-------|---------|
| `complaints` | Primary complaint record (status, severity, location, media refs) |
| `complaint_events` | Status change audit trail |
| `complaint_assignments` | Inspector/contractor assignments |
| `complaint_media` | Supabase storage references |
| `complaint_anchors` | Fabric tx hash, Merkle root, batch ID |
| `kafka_event_outbox` | Transactional outbox for Kafka publishing |

Complaint status flow: `submitted` → `acknowledged` → `in_progress` → `resolved` / `rejected` / `escalated`.

### Authority and contractors

| Table | Purpose |
|-------|---------|
| `authority_profiles` | EE jurisdiction (state/district) |
| `contractor_profiles` | Contractor company, assigned roads |
| `repair_proofs` | Before/after photos, completion evidence |
| `work_orders` | Contractor task assignments |

### RTI

| Table | Purpose |
|-------|---------|
| `rti_requests` | RTI application lifecycle |
| `rti_responses` | Authority responses and evidence |
| `rti_deadlines` | Computed deadline dates per India RTI rules |

### Analytics and karma

| Table | Purpose |
|-------|---------|
| `citizen_karma` | Gamification scores |
| `chronic_roads` | Materialized chronic complaint roads |
| `analytics_snapshots` | Pre-computed dashboard metrics |
| `audit_log` | System-wide audit entries |

### Notifications

| Table | Purpose |
|-------|---------|
| `notifications` | In-app notification queue |
| `notification_preferences` | Per-user channel preferences |

## Schema initialization

1. **Docker init**: `docker/postgres/init.sql` runs on first Postgres container start.
2. **Runtime init**: Gateway `initDb()` applies any additional migrations from `packages/core/migrations/`.

There is no separate `db:migrate` CLI command — schema evolves through init SQL and runtime migration files.

## Fabric ledger data

The `complaint-anchor` chaincode stores:

- Merkle root of batched complaint hashes
- Batch metadata (timestamp, count)
- Per-complaint anchor references (complaint ID → batch → tx hash)

Full complaint payloads (PII, photos, descriptions) remain in Postgres/Supabase only.

## Redis keys

| Pattern | Purpose |
|---------|---------|
| `otp:*` | Active OTP codes |
| `otp_rate:*` | Rate limit counters |
| `idempotency:*` | Request deduplication |
| `complaints:*` | Hot complaint cache |
| `tag:*` | Complaint tag cache |

## Media storage

Complaint photos and videos upload to Supabase Storage. The database stores bucket paths and public URLs. The optional `media-ingest` service can process and analyze uploaded media.

## Related docs

- [Complaint lifecycle](../workflows/complaint-lifecycle.md)
- [Database infrastructure](../infrastructure/database.md)
- [RTI workflow](../workflows/rti.md)
