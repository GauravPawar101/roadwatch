# Media Ingest

Optional prototype service for image upload processing and analysis. Enabled via Docker Compose `media` profile.

## Details

| Property | Value |
|----------|-------|
| Package | `media-ingest-prototype` |
| Entry | `services/media-ingest/src/index.js` |
| Port | `4000` (`PORT`) |
| Profile | `media` (not started by default) |

## Start

```powershell
docker compose --profile media up -d
```

## Responsibilities

- Receive uploaded complaint media
- Compress and optimize images
- Publish `media-uploaded` and `media-analyzed` events to kafka-events
- Optional Supabase/AWS storage integration

## Environment

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP listen port |
| `DATABASE_URL` | Postgres |
| `GATEWAY_URL` | Service registration |
| Supabase/AWS vars | Storage backend |

## Status

This is a prototype service. Production media handling is primarily done via Supabase Storage directly from the gateway and mobile app.

## Related docs

- [Complaint lifecycle](../workflows/complaint-lifecycle.md)
- [Event pipeline](../architecture/event-pipeline.md)
