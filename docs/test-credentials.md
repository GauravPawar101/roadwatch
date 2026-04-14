# Test credentials / env setup

This repo uses **local env files** (not committed) for running services and tests.

## 0) Prereqs (required)

- Node.js (LTS) + `pnpm`
  - If you see `exit code 127` running `pnpm ...`, install Node first.

## 1) Gateway API (apps/gateway-api)

**Where:** `apps/gateway-api/.env`

**Start from:** `apps/gateway-api/.env.example` → copy to `.env`

Required for most dev flows:
- `DATABASE_URL`
- `JWT_SECRET`
- `ALLOW_DEV_OTP_ECHO=true` (dev-only OTP flow)

LLM (choose one):
- Gemini:
  - `GEMINI_API_KEY`
  - optional: `GEMINI_MODEL`, `GEMINI_API_BASE_URL`
- Ollama:
  - `OLLAMA_BASE_URL` (example `http://127.0.0.1:11434`)
  - optional: `OLLAMA_MODEL`
- llama.cpp (OpenAI-compatible; required if you want tool-calling):
  - `LLAMACPP_BASE_URL` (example `http://127.0.0.1:8080`)
  - optional: `LLAMACPP_MODEL`

Optional:
- Kafka (enables publishing events):
  - `UPSTASH_KAFKA_REST_URL`
  - `UPSTASH_KAFKA_REST_USERNAME`
  - `UPSTASH_KAFKA_REST_PASSWORD`

### Getting an auth token (for authority tool calls)

Authority tooling on `/agent/chat` is only enabled when you pass a valid JWT.

1) Request OTP (dev returns `devCode` if `ALLOW_DEV_OTP_ECHO=true`):

```bash
curl -sS -X POST http://localhost:3000/auth/otp/request \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+911234567890"}'
```

2) Verify OTP and get JWT:

```bash
curl -sS -X POST http://localhost:3000/auth/otp/verify \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+911234567890","sessionId":"<sessionId>","code":"<devCode>"}'
```

3) Call the agent with auth:

```bash
curl -sS -X POST 'http://localhost:3000/agent/chat' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"input":"Mark complaint RW-ABC-123 as IN_PROGRESS with note: crew dispatched"}'
```

## 2) Fabric scripts (repo root)

**Where:** set env vars in your shell, or put them in a local `.env` and export.

These scripts require:
- `FABRIC_PEER_ENDPOINT`
- `FABRIC_PEER_HOST_ALIAS`
- `FABRIC_TLS_CERT_PATH` (peer TLS CA cert)
- `FABRIC_MSP_ID`
- `FABRIC_IDENTITY_CERT_PATH` (user cert PEM)
- `FABRIC_IDENTITY_KEY_PATH` (user private key PEM)
- `FABRIC_CHANNEL`
- `FABRIC_CHAINCODE`

Example:

```bash
export FABRIC_PEER_ENDPOINT='peer0.example.com:7051'
export FABRIC_PEER_HOST_ALIAS='peer0.example.com'
export FABRIC_TLS_CERT_PATH='/abs/path/to/tls/ca.crt'
export FABRIC_MSP_ID='RoadWatchMSP'
export FABRIC_IDENTITY_CERT_PATH='/abs/path/to/cert.pem'
export FABRIC_IDENTITY_KEY_PATH='/abs/path/to/key.pem'
export FABRIC_CHANNEL='roadwatch-india'
export FABRIC_CHAINCODE='complaint-anchor'
```

Then run:

```bash
pnpm seed:fabric
pnpm query:fabric:history
pnpm query:fabric:by-road
```

## 3) Deterministic test IDs

**Where:** `scripts/test-ids.env`

You can export these into your shell (for scripts) or copy values into a local `.env`.

