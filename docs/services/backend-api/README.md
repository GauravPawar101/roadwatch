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

- `GET /health` — health check
- `GET /health/db` — DB connectivity check
- `POST /complaints` — Create or merge a complaint (auxiliary ingest). Applies distance, freshness and rate checks. Requires service-to-service / sidecar authentication in production (permissive in dev).
- `GET /complaints/:id` — Retrieve complaint details by ID
- `POST /webhook/fabric-state-change` — External webhook for Fabric state events (complaint-submitted, complaint-anchored, complaint-status-changed). Publicly exposed (no sidecar auth) so external systems can call it.
- `POST /submissions/nonce` — Generate a short-lived nonce for image verification (requires authenticated user context via sidecar)
- `POST /submissions` — Submit a geotagged image (raw octet-stream payload). Verification, nonce checks, duplicate detection and karma updates are applied.
- `GET /submissions/:id` — Retrieve a single submission with privacy filtering
- `GET /submissions` — List/filter submissions (restricted to authority/admin)
- `GET /karma/:userId` — Get karma record for a user (privacy checks apply)
- `GET /karma/leaderboard` — Karma leaderboard (authority/admin)
- `POST /analytics/collect` — Simple analytics collector (expects service JWT)

## Main Flow

1. The client sends a JWT-authenticated complaint or media request.
2. The service validates distance, freshness, and rate limits.
3. Complaint and attachment records are written to PostgreSQL.
4. Complaint events are emitted to Kafka.
5. Fabric state webhooks are mirrored back into the shared database.

## State In The Repo

- The service is present and runnable, but it should be treated as auxiliary to `apps/gateway-api`.
- It is the best place to read the media-verification and alternate complaint ingest flow.
 - The service is present and runnable, but it should be treated as auxiliary to `apps/gateway-api`.
 - It reuses the gateway database connection and some shared helpers from `apps/gateway-api`.
 - Refer to the source for exact shape of payloads and authentication requirements; this README summarizes the currently implemented routes.