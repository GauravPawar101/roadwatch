# Media Ingest (Prototype)

**Package:** `media-ingest-prototype`

**Version:** `0.1.0`

## Overview

A small, standalone prototype service that accepts geotagged image submissions, performs basic deduplication/freshness checks, and persists verification state to a database. Intended as a reference implementation — not currently wired into monorepo orchestration.

## Status

- Legacy / prototype: useful as a reference but not production-hardened.
- Not registered in root orchestration by default. Re-integrate explicitly if needed.

## Features

- HTTP endpoint for image upload (multipart/form-data)
- Stores submission metadata and verification state
- Perceptual-hash (pHash) based duplication detection
- Nonce generation and freshness checks for submission integrity
- Optional Hugging Face vision analysis using YOLOv8 and ResNet

## Tech Stack

- Node.js + Express
- PostgreSQL (via `pg`)
- `multer` for multipart uploads
- pHash library for perceptual hashing

## Quick start (local)

1. Install dependencies (from this folder):

```bash
pnpm install
pnpm build   # if project uses a build step
```

2. Create a `.env` file (see Env section) and start:

```bash
pnpm start
# or for development with hot-reload
pnpm dev
```

3. Upload an image with curl (example):

```bash
curl -X POST http://localhost:3000/upload \
	-F "image=@/path/to/photo.jpg" \
	-F "lat=12.34" -F "lng=56.78" \
	-F "nonce=<client-nonce>"
```

## Environment variables

- `PORT` — HTTP port (default: `3000`)
- `DATABASE_URL` — Postgres connection string
- `PHASH_THRESHOLD` — pHash distance threshold for duplicates (optional)
- `NODE_ENV` — `development` | `production`
- `HF_API_KEYS` — comma-separated Hugging Face API keys used for inference
- `HF_YOLO_MODEL` — Hugging Face object-detection model, defaults to `ultralytics/yolov8n`
- `HF_RESNET_MODEL` — Hugging Face image-classification model, defaults to `microsoft/resnet-50`

## API (important endpoints)

- `POST /upload` — multipart form: `image` (file), `lat`, `lng`, `nonce` → returns submission id and verification status
- `GET /status/:id` — returns stored metadata and verification result for a submission

When Hugging Face keys are configured, uploads also store a normalized `hf_result` payload with the top YOLO detections and top ResNet classifications.

Adjust these if the implementation differs; use the source code in this folder as the canonical reference.

## Docker

Build and run locally (prototype convenience):

```bash
docker build -t media-ingest-prototype .
docker run --env-file .env -p 3000:3000 media-ingest-prototype
```

There is a small `docker-compose` included for local DB + service if you need a repeatable local environment.

## Integration notes

- If you plan to re-integrate this service into the monorepo orchestration, add an entry in the top-level compose or service inventory and ensure `DATABASE_URL` and any secrets are provided via the shared secrets mechanism.
- Consider hardening: auth, rate-limiting, virus scanning, more robust storage (S3/GCS) and background processing for heavy image work.

## Contributing / Maintainers

This is a legacy prototype. For quick fixes or updates, open a PR against this folder. For larger work, discuss integration strategy first with the core maintainers.

---

If you'd like, I can also:

- Add a minimal example test that uploads a sample image.
- Wire the service into monorepo `docker-compose` for local dev.
- Generate OpenAPI docs for the endpoints.

Tell me which of these you'd like next.