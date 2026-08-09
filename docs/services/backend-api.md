# Backend API

Internal data API for complaints, analytics, image submissions, and webhook processing. Uses sidecar auth to validate requests via the gateway.

## Details

| Property | Value |
|----------|-------|
| Package | `@roadwatch/backend-api` |
| Entry | `backend-api/src/index.ts` |
| Port | `4001` (`BACKEND_PORT`; falls back to `5001` if blocked on Windows) |
| Dev command | `pnpm dev:backend` |

## Responsibilities

- Internal complaint data access for services
- Analytics aggregation endpoints
- Image submission processing
- Complaint outbox relay (publishes to Kafka)
- Webhook callback handling

## Authentication

Uses `@roadwatch/sidecar-auth` middleware. On startup, registers with the gateway using `SERVICE_REGISTRY_SECRET` and validates incoming service JWTs.

Loads shared secrets from `apps/gateway-api/.env` when present.

## Key source files

| File | Purpose |
|------|---------|
| `src/routes/complaints.ts` | Complaint CRUD and event emission |
| `src/services/complaintOutbox.ts` | Kafka outbox relay |
| `src/services/kafka.ts` | Kafka producer wrapper |

## Testing

```powershell
pnpm test:backend
```

## Related docs

- [Security and auth](../architecture/security-and-auth.md)
- [Event pipeline](../architecture/event-pipeline.md)
