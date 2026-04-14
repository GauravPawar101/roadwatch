# Onboarding ops (regions + offline bootstrap)

This repo supports a **DB-backed region registry** to power:

- Mobile first-run “district selection”
- Offline bootstrap (manifest + road index download)

## Prereqs

- A Postgres instance reachable via `DATABASE_URL` (same env var used by the gateway API).
- Run the gateway once (or run the seed script which creates the minimal schema for region tables).

## Public endpoints used by mobile

- `GET /public/countries`
- `GET /public/states?country=IN`
- `GET /public/districts?country=IN&state=DL`
- `GET /public/districts/:districtId/offline-manifest`
- `GET /public/districts/:districtId/roads`

## CE-only admin endpoints (manual onboarding)

These require a `CE` user auth token (same auth as other `/admin/*` endpoints).

- `POST /admin/regions/countries`
  - Body: `{ "code": "IN", "name": "India", "defaultTimeZone": "Asia/Kolkata" }`
- `POST /admin/regions/states`
  - Body: `{ "countryCode": "IN", "code": "DL", "name": "Delhi" }`
- `POST /admin/regions/districts`
  - Body: `{ "countryCode": "IN", "stateCode": "DL", "code": "DL-ND", "name": "New Delhi", "bbox": { ... }, "zoom": {"min":10,"max":16} }`
- `POST /admin/regions/districts/:districtId/roads`
  - Body: `{ "roads": [{ "id": "RD-001", "name": "Ring Road", "roadType": "ARTERIAL", "authorityId": "AUTH-1", "totalLengthKm": 48 }] }`

## Seed pipeline (recommended for dev)

A seed script is provided that **upserts** countries/states/districts/roads into Postgres from a JSON file.

From repo root:

- `pnpm seed:backend -- --file apps/gateway-api/scripts/seeds/india-demo.json`

Notes:
- The extra `--` is required so pnpm passes args through.
- This is safe to re-run; it uses `ON CONFLICT ... DO UPDATE`.

## Offline tiles

The mobile flow currently downloads the **manifest + road index** for offline use. Actual map tile pack download depends on which map SDK/cache strategy we standardize on (MapLibre/Mapbox/offline raster packs). Once that’s chosen, we can extend the manifest and downloader to fetch tiles for `bbox` + `zoom`.
