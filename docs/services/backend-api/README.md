# Backend API

**Package:** `@roadwatch/backend-api`

**Role:** auxiliary complaint, image-submission, analytics, and webhook support service.

## Current Version And Stack

- Express `4.21.2`
- JWT `9.0.2`
- CORS `2.8.5`
- Morgan `1.10.0`
- `express-rate-limit` `7.5.1`
- `tsx` for local development

## What It Does

- Accepts complaint creation requests on the auxiliary path.
- Accepts image submission and verification requests.
- Exposes simple analytics collection and webhook endpoints.
- Reuses the gateway database connection and schema from `apps/gateway-api`.

## Routes

- `GET /health`
- `GET /health/db`
- `POST /complaints`
- `POST /complaints/:id/repair-verification`
- `POST /complaints/:id/status`
- `POST /complaints/:id/escalate`
- `POST /submissions/nonce`
- `POST /submissions`
- `POST /webhook/fabric-state-change`
- `POST /analytics/collect`

## Main Flow

1. The client sends a JWT-authenticated complaint or media request.
2. The service validates distance, freshness, and rate limits.
3. Complaint and attachment records are written to PostgreSQL.
4. Complaint events are emitted to Kafka.
5. Fabric state webhooks are mirrored back into the shared database.

## State In The Repo

- The service is present and runnable, but it should be treated as auxiliary to `apps/gateway-api`.
- It is the best place to read the media-verification and alternate complaint ingest flow.