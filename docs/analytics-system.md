# RoadWatch analytics system

This repo previously had analytics UI screens (authority portal), but lacked a defined analytics storage + public-facing analytics API. This document describes the minimal analytics model implemented in `apps/gateway-api`.

## Where analytics data is stored

All analytics for dashboards, trends, clustering, and exports is derived from:

- **Operational table:** `complaints`
  - Used for counts by status, chronic aging (60+ days), geo exports, and clustering/trends (when `lat/lng` exist).

- **Append-only event stream:** `analytics_events`
  - Written on key lifecycle actions (create, status change, escalate, resolve, assign, SLA warning).
  - Intended for auditing/analytics joins and future time-series queries.

- **Contractor linkage (for scorecards):**
  - `contractors` (public contractor registry)
  - `complaint_assignments` (assigns a complaint to a contractor, optional SLA expectation)

## Analytics event model

Table: `analytics_events`

| Column | Meaning |
|---|---|
| `id` | UUID event id |
| `type` | Event type string (see below) |
| `actor_user_id` | Authority user id (nullable) |
| `complaint_id` | Related complaint id (nullable) |
| `contractor_id` | Related contractor id (nullable) |
| `district`, `zone` | Jurisdiction (nullable) |
| `lat`, `lng` | Event location (nullable) |
| `occurred_at` | Timestamp (defaults to `now()`) |
| `properties` | JSON payload for event-specific fields |

### Tracked event types

Events are written from `apps/gateway-api/src/routes/authority.ts`.

- `COMPLAINT_CREATED`
  - properties: `{ status: 'PENDING' }`
- `COMPLAINT_STATUS_CHANGED`
  - properties: `{ from: string, to: string }`
- `COMPLAINT_ESCALATED`
  - properties: `{ reason: string | null }`
- `COMPLAINT_RESOLVED`
  - properties: `{ resolutionNote: string | null }`
- `COMPLAINT_ASSIGNED`
  - properties: `{ expectedResolutionDays: number | null, notes: string | null }`
- `SLA_WARNING`
  - properties: `{ status: string, message: string | null }`

## Public analytics (no login)

The citizen-facing endpoints live under `GET /public/*` in the gateway API.

### Public dashboard

- `GET /public/dashboard`
  - Returns city-wide counts, a simple road health index (0–100), chronic feed, hotspots, trend signals, and contractor scorecard.
  - The dashboard does **not** expose complaint details except via the chronic feed.

### Chronic road public feed (60+ day rule)

- `GET /public/chronic-roads?days=60`
  - Rule: any complaint with `status <> 'RESOLVED'` and `created_at <= now() - days` is considered **chronic** and becomes visible in the public feed.

### Contractor performance public scorecard

- `GET /public/contractors/scorecard`
  - Calculated from `complaint_assignments JOIN complaints`.
  - Metrics: assigned/resolved/open, avg resolution days, SLA breach count, on-time rate.

### Trend detection

- `GET /public/trends`
  - “Worsening” is detected by comparing recent vs previous complaint creation counts per grid cell + open backlog.

### Geospatial clustering (hotspots)

- `GET /public/hotspots`
  - Uses a simple grid bucketing of complaint coordinates (default ~1km cells).
  - Output includes centroid and count per cluster.

## Export formats

Implemented as public exports:

- CSV: `GET /public/export/roads.csv`
- PDF: `GET /public/export/roads.pdf`
- GeoJSON: `GET /public/export/roads.geojson`

Exports default to chronic-only where applicable to match the public-feed policy.
