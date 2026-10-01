# Media Ingest Service

## Overview

The media-ingest service handles image/video upload, EXIF extraction, geofence validation, perceptual hashing, and nonce verification for citizen complaint media.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/media/verify` | Verify image against EXIF, geofence, timestamp, nonce, duplicate |
| `POST` | `/media/upload` | Upload image to Supabase Storage, attach to complaint |
| `GET` | `/health` | Health check |

## Verification Pipeline (`POST /media/verify`)

### Input
- `image` (multipart file) — JPEG image
- `expectedLat`, `expectedLng` (required) — Complaint location center
- `geofenceRadiusMeters` (optional, default: 50) — Acceptable distance
- `timeWindowMs` (optional, default: 300000 = 5 min) — Max age of EXIF timestamp
- `phashThreshold` (optional, default: 8) — Hamming distance for duplicate detection
- `nonce`, `expectedNonce` (optional) — Server-issued nonce for replay protection

### Checks performed
1. **EXIF timestamp** — Within `timeWindowMs` of server receive time
2. **Geofence** — GPS (EXIF or device) within `geofenceRadiusMeters` of expected
3. **Nonce** — Matches expected, not expired
4. **Perceptual hash** — No near-duplicate in recent submissions (Hamming ≤ threshold)

### Response
```json
{
  "ok": true,
  "exif": { "timestamp": 123, "latitude": 12.3, "longitude": 77.4, "make": "Pixel", "model": "7a" },
  "checks": [
    { "name": "exif_time_validation", "passed": true, "detail": "Timestamp valid: 120ms difference (< 300000ms window)" },
    { "name": "geofence_validation", "passed": true, "detail": "Within geofence: 12.34m from center (< 50m)" },
    { "name": "nonce_validation", "passed": true, "detail": "Nonce valid and not expired (590000ms remaining)" },
    { "name": "duplicate_check", "passed": true, "detail": "No duplicates detected" }
  ],
  "errors": [],
  "warnings": []
}
```

## Upload Pipeline (`POST /media/upload`)

### Input
- `image` (multipart file)
- `complaintId` (required)
- `capturedLat`, `capturedLng`, `capturedAt` (optional)

### Behavior
1. Extract EXIF, compute SHA-256
2. Upload to Supabase Storage (or local fallback)
3. Insert `complaint_attachments` row with metadata

## Implementation

- Built on `@roadwatch/core/verification-service` (shared EXIF, phash, validation)
- Uses Supabase Storage (S3-compatible) with local fallback for dev
- Runs as standalone service on port 4000 (configurable via `MEDIA_INGEST_PORT`)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEDIA_INGEST_PORT` | `4000` | HTTP port |
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_ANON_KEY` | — | Supabase anon key |
| `SUPABASE_STORAGE_BUCKET` | `roadwatch-media` | Storage bucket name |
| `DATABASE_URL` | — | Postgres (via PgBouncer) |

## Docker

```bash
docker compose --profile media up -d media-ingest
```

## Testing

```bash
# Verify image
curl -X POST -F "image=@photo.jpg" \
  -F "expectedLat=12.9716" -F "expectedLng=77.5946" \
  http://localhost:4000/media/verify

# Upload for complaint
curl -X POST -F "image=@photo.jpg" \
  -F "complaintId=uuid-here" \
  http://localhost:4000/media/upload
```