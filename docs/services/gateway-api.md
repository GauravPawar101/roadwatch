# Gateway API

The primary REST API for RoadWatch. Handles authentication, all role-based routes, public dashboards, RTI, reports, notifications, AI agent, and SSE.

## Details

| Property | Value |
|----------|-------|
| Package | `@roadwatch/gateway-api` |
| Entry | `apps/gateway-api/src/index.ts` → `createApp()` in `app.ts` |
| Port | `3100` (`PORT`) |
| Dev command | `pnpm dev:api` |

## Route groups

| Prefix | Role | Key endpoints |
|--------|------|---------------|
| `/auth` | Public | OTP request/verify, refresh, logout |
| `/citizen` | CITIZEN | File complaint, track, karma, profile |
| `/authority` | EE/CE | Triage, assign, resolve, analytics, reports |
| `/contractor` | CONTRACTOR | Work orders, repair proofs |
| `/admin` | CE | User management, system config |
| `/public` | Public | Dashboard, chronic roads, agent chat |
| `/rti` | Mixed | RTI filing and tracking |
| `/reports` | CE | Ministry PDF reports |
| `/notifications` | Authenticated | Notification preferences |
| `/health` | Public | Health check |

## Key responsibilities

- JWT authentication and OTP management
- Complaint CRUD with geospatial road matching
- Transactional Kafka outbox (dual-cluster publishing)
- SSE real-time updates to connected clients
- LangGraph AI agent pipeline (`POST /public/agent/chat`)
- Service registry for internal services
- Rate limiting and idempotency via Redis
- Supabase media upload coordination

## Environment

See [Environment variables](../getting-started/environment-variables.md#gateway-api-appsgateway-apienv).

## Key source files

| File | Purpose |
|------|---------|
| `src/app.ts` | Express app factory, middleware stack |
| `src/routes/citizen.ts` | Citizen complaint routes |
| `src/routes/authority.ts` | Authority management routes |
| `src/routes/rti.ts` | RTI workflow |
| `src/routes/public.ts` | Public dashboards and agent |
| `src/kafka/outbox.ts` | Transactional outbox relay |
| `src/services/fabric-ledger.ts` | Fabric query integration |
| `scripts/seed-demo-data.ts` | Demo data seeder |

## Testing

```powershell
pnpm test:api
pnpm test:watch:api
```

Tests use Vitest + Supertest. Key test files: `src/app.test.ts`, `src/anomaly.test.ts`.

## Related workflows

- [Complaint lifecycle](../workflows/complaint-lifecycle.md)
- [RTI](../workflows/rti.md)
- [AI agent](../workflows/ai-agent.md)
