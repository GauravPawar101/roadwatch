# Managed services

Which managed endpoint each service uses, how to verify it, and what the
fallback does. Written against the configuration actually in `.env` and
verified against the live providers.

## The order every service follows

`reportInfrastructure(serviceName)` in
`packages/core/src/infrastructure-report.ts` runs the same sequence in all five
services (`gateway-api`, `backend-api`, `scheduler`, `webhook-handler`,
`fabric-anchor-consumer`):

1. **Try the managed tier.** The resolver in
   `packages/core/src/config/endpoints.ts` checks the cloud variables first.
2. **Report what actually resolved.** Names every component running on-device,
   and flags any managed value that is configured but unusable. `console.error`
   for a real problem, `console.warn` for an expected local fallback.
3. **Start on the resolved endpoint**, managed or not.

With `INFRA_REQUIRE_MANAGED=true` a configured-but-unusable managed value throws
before any connection is attempted, so the failure names the variable instead of
surfacing later as a connection timeout. A component with nothing configured is
still allowed, so a fully local run keeps working.

## Where each service's endpoint comes from

| Component | Managed variable | Falls back to | Verified |
|---|---|---|---|
| Postgres | `DATABASE_CLOUD_URL` | `DATABASE_URL`, then `PGHOST`/etc., then `127.0.0.1:16432` | Aiven, TLSv1.3 |
| Redis | `REDIS_CLOUD_URL`, `REDIS_MANAGED_URL`, or the Upstash REST pair | `REDIS_URL`, then `REDIS_HOST`/`REDIS_PORT` | Upstash, TLS |
| Kafka events | `KAFKA_EVENTS_CLOUD_BROKERS` | `KAFKA_EVENTS_BROKERS`, then `KAFKA_BROKERS` | on-device |
| Kafka hlf | `KAFKA_HLF_CLOUD_BROKERS` | `KAFKA_HLF_BROKERS` | on-device |

Every connection point goes through that one resolver: the core pool
(`packages/core/src/postgres.ts`), the adapter pool
(`packages/core/src/postgres-adapter.ts`), the gateway pool
(`apps/gateway-api/src/postgres.ts`), the Redis client
(`packages/redis/config.ts`), the Kafka client
(`packages/kafka/config.ts`), and the gateway's boot assertion.

## What is configured now

Measured with `npm run verify:managed` against the live providers.

```
[PASS] postgres   roadwatch-pg-….b.aivencloud.com  TLSv1.3 encrypted, 53 public tables
[PASS] redis      maximum-goose-76110.upstash.io:6379  reachable (tls)
[SKIP] kafka.events  on-device broker 127.0.0.1:9095
[SKIP] kafka.hlf     on-device broker 127.0.0.1:9094
```

- **Postgres — Aiven.** Reachable, encrypted, schema loaded, write path
  exercised end to end.
- **Redis — Upstash.** Reachable over TLS. The managed tier is derived from the
  Upstash console's `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`; see
  below.
- **Kafka — on-device.** No hosted cluster is configured, so both clusters use
  the local compose brokers on 9095/9094. `KAFKA_SSL` must be `false` for these
  (see *Kafka TLS* below).

## Upstash: REST credentials are enough

The Upstash console hands out a REST endpoint and a token, not a `rediss://`
URL, and the client here is ioredis, which speaks the TCP protocol. Passing a
REST URL to ioredis produces an unhelpful connection error rather than a clear
"wrong endpoint type".

`deriveUpstashTcpUrl` in `packages/core/src/config/endpoints.ts` builds the TCP
URL from the pair — same host, same token, `rediss://` — and
`resolveRedisEndpoint` applies it to the managed tier. So either form works:

```
REDIS_CLOUD_URL=rediss://default:<token>@<host>:6379
# or
UPSTASH_REDIS_REST_URL=https://<host>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
```

An explicit `REDIS_CLOUD_URL` still wins. The derivation lives in the shared
resolver rather than in the Redis client, so the startup report and the client
cannot report different endpoints.

## Kafka TLS follows the brokers, not a global switch

A single `KAFKA_SSL` flag cannot be correct for every deployment. Managed
clusters require TLS and refuse plaintext; the on-device stack is plaintext and
has no certificate to present. Setting the flag once for the managed case
silently breaks the local one, and leaving it off silently breaks the managed
one. Both failures are quiet — a TLS handshake against a plaintext broker
retries for a long time before giving up.

So:

- When `KAFKA_SSL` (or `KAFKA_<CLUSTER>_SSL`) is **absent**, TLS is inferred
  from the brokers themselves: every broker must be remote, meaning not
  loopback, not a private address, and not a `.svc.`/`.cluster.local` in-cluster
  name. A per-cluster value overrides the shared one.
- When it is **present**, it is honoured as given, and `describeKafkaTlsProblem`
  reports a contradiction in the startup log — TLS on against plaintext brokers,
  or off against remote ones.

The signal is the brokers, not the variable that supplied them: a managed cluster
can legitimately be named in `KAFKA_EVENTS_BROKERS`, and keying TLS off the
variable name would misconfigure a valid remote broker list.

## Postgres TLS: `sslmode=require` does not mean what it says

Since `pg-connection-string` 2.7, `sslmode=require`, `prefer` and `verify-ca`
are all treated as aliases for `verify-full`. Every provider documents
`?sslmode=require`, so a URL written the documented way makes the client verify
the certificate chain — and managed providers present a certificate that
verification rejects, because Aiven and RDS use a private CA that is not in the
system trust store.

Measured against Aiven PostgreSQL 18.6 with `pg` 8.21:

| Connection string | Result |
|---|---|
| `?sslmode=require` | fails — `self-signed certificate in certificate chain` |
| `?sslmode=no-verify` | connects, TLSv1.3, reads normally |

`normaliseSslMode` in `packages/core/src/ssl-mode.ts` rewrites the mode to
`no-verify` — node-postgres' own spelling of libpq's `require`, meaning encrypt
without checking who is on the other end — whenever the application is also
passing `ssl: { rejectUnauthorized: false }`, which it does for every managed
endpoint. It is applied in all three pool constructors.

An explicit `sslmode=verify-full` is **left alone**: that is a deliberate request
to check the chain, and downgrading it would remove the protection the operator
asked for, including the case where a provider CA is installed properly and
verification should succeed.

## Verifying

Read-only unless stated. None of these print a credential value.

```
npm run verify:managed       # reach every configured endpoint; report the fallback
npm run verify:schema        # which of the 53 tables exist
npm run verify:write-path    # run the real create transaction, then delete the row
npm run ops:apply-schema     # WRITES: applies docker/postgres/init.sql (re-runnable)
```

`verify:write-path` is the one that matters most. A schema can load cleanly and
still be unusable — a managed instance can lack a privilege, a constraint or an
extension the on-device database has — and the only way to find out is to run
the write. It inserts one labelled probe row across `complaints`,
`complaint_event_outbox` and `api_idempotency_keys` in a single transaction,
reads it back, checks the dedupe partial index exists, and deletes everything in
a `finally` block.

## Applying the schema to a new database

The Postgres image runs `docker/postgres/init.sql` only on the first start of an
empty data directory. That is why the on-device stack has a schema and a
freshly created managed database does not: **nothing else creates these tables.**

```
psql "$DATABASE_CLOUD_URL" -v ON_ERROR_STOP=1 -f docker/postgres/init.sql
```

`npm run ops:apply-schema` does the same through the application's own
connection path, refuses to run if the script contains a destructive statement,
counts distinct table names, and verifies per table rather than by count. The
script is 53 `CREATE TABLE IF NOT EXISTS` plus 55 additive
`ADD COLUMN IF NOT EXISTS` — no `DROP`, no `TRUNCATE`, no role changes — so it is
re-runnable and destroys nothing.

## Error tracking

Both are configured in `.env`; neither is wired into the code yet.

- **Sentry** — `SENTRY_DSN` for runtime, plus `SENTRY_ORG` / `SENTRY_PROJECT` /
  `SENTRY_AUTH_TOKEN` for source-map upload in CI.
- **Honeybadger** — `HONEYBADGER_API_KEY` / `HONEYBADGER_TOKEN`. This was not in
  the original list of services and is not integrated.

Running two error trackers is legitimate but usually means one is primary and the
other is a mirror, so it is worth deciding which is which before wiring.

## Profiling

`BLACKFIRE_ID` / `BLACKFIRE_SECRET` are set. The recorded `BLACKFIRE_ID` is 36
characters where Blackfire client IDs are normally 32 hex characters, so it is
worth confirming the value is a client ID and not something else before relying
on it.
