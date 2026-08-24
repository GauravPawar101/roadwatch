# Environment Variables

RoadWatch uses per-service `.env` files. Never commit real secrets — they are excluded by `.gitignore`.

## Gateway API (`apps/gateway-api/.env`)

Primary configuration for the REST API.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3100` | HTTP listen port |
| `NODE_ENV` | No | `development` | Runtime mode |
| `DATABASE_URL` | **Yes** | — | Postgres via PgBouncer: `postgresql://postgres:postgres@127.0.0.1:16432/roadwatch` |
| `JWT_SECRET` | **Yes** | — | Signs access/refresh tokens |
| `ACCESS_SECRET` | No | falls back to `JWT_SECRET` | Access token signing |
| `REFRESH_SECRET` | No | falls back to `JWT_SECRET` | Refresh token signing |
| `OTP_TTL_SECONDS` | No | `300` | OTP expiry |
| `ALLOW_DEV_OTP_ECHO` | No | `true` in dev | Return OTP in API response (dev only) |
| `KAFKA_HLF_BROKERS` | **Yes** | `127.0.0.1:9094` | HLF backpressure cluster |
| `KAFKA_EVENTS_BROKERS` | **Yes** | `127.0.0.1:9095` | Operational events cluster |
| `REDIS_URL` | **Yes** | `redis://127.0.0.1:16379/0` | OTP, idempotency, cache (DB 0) |
| `SUPABASE_URL` | For media | — | Supabase project URL |
| `SUPABASE_ANON_KEY` | For media | — | Supabase anon key |
| `SUPABASE_STORAGE_BUCKET` | For media | `roadwatch-media` | Media upload bucket |
| `GEMINI_API_KEY` | For AI | — | Google Gemini for agent chat |
| `GEMINI_MODEL` | No | `gemini-2.0-flash` | Gemini model name |
| `OLLAMA_BASE_URL` | No | — | Local Ollama fallback |
| `LLAMACPP_BASE_URL` | No | — | llama.cpp server fallback |
| `LLM_FALLBACK_ORDER` | No | `gemini,ollama,llamacpp` | LLM provider priority |
| `FABRIC_PEER_ENDPOINT` | For Fabric | — | e.g. `localhost:17051` |
| `FABRIC_MSP_ID` | For Fabric | `RoadWatchMSP` | MSP identity |
| `FABRIC_CHANNEL` | For Fabric | `roadwatch-india` | Channel name |
| `FABRIC_CHAINCODE` | For Fabric | `complaint-anchor` | Chaincode name |
| `INTERNAL_SERVICE_TOKEN` | No | — | Local worker → gateway `/internal/*` |
| `COMPLAINT_WRITE_MAX_PER_MINUTE` | No | `120` | Adaptive write admission upper bound |
| `COMPLAINT_WRITE_MAX_INFLIGHT` | No | `24` | Adaptive write admission inflight upper bound |
| `PHONE_HASH_PEPPER` | Prod | — | Phone number hashing |
| `PHONE_ENC_KEY` | Prod | — | Base64 32-byte phone encryption key |

## Backend API (`backend-api/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BACKEND_PORT` | No | `4001` | HTTP listen port |
| `DATABASE_URL` | **Yes** | — | Same PgBouncer URL as gateway |
| `GATEWAY_URL` | **Yes** | `http://127.0.0.1:3100` | Gateway for sidecar auth |
| `SERVICE_NAME` | No | `backend-api` | Service registry name |
| `CORS_ORIGIN` | No | `http://127.0.0.1:5173` | Allowed frontend origin |

The backend loads `apps/gateway-api/.env` for shared secrets when present.

## Fabric anchor consumer (`services/fabric-anchor-consumer/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | **Yes** | Postgres connection |
| `KAFKA_HLF_BROKERS` | **Yes** | `127.0.0.1:9094` |
| `KAFKA_EVENTS_BROKERS` | **Yes** | `127.0.0.1:9095` |
| `KAFKA_CONSUMER_GROUP_ID` | No | Consumer group (default: `fabric-anchor-consumer`) |
| `REDIS_URL` | **Yes** | `redis://127.0.0.1:16379/2` (DB 2) |
| `FABRIC_PEER_ENDPOINT` | **Yes** | Peer gRPC endpoint |
| `FABRIC_MSP_ID` | **Yes** | e.g. `NHAIMSP` or `RoadWatchMSP` |
| `FABRIC_CHANNEL_NAME` | No | `roadwatch-india` |
| `FABRIC_CHAINCODE_NAME` | No | `complaint-anchor` |
| `GATEWAY_URL` | No | For service registration |

## Frontend (`frontend/.env` or Vite env)

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE` | Gateway URL, e.g. `http://127.0.0.1:3100` |
| `VITE_PORT` | Dev server port (default `5173`) |

## Mobile (`apps/mobile-host/.env`)

| Variable | Description |
|----------|-------------|
| `API_GATEWAY_URL` | Gateway URL |
| `GEMINI_API_KEY` | On-device agent (restrict in production) |
| `SUPABASE_URL` | Media storage |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_STORAGE_BUCKET` | Upload bucket name |

## Docker Compose port overrides

Override host ports without editing `docker-compose.yml`:

| Variable | Default |
|----------|---------|
| `TOP_POSTGRES_HOST_PORT` | `15433` |
| `TOP_PGBOUNCER_HOST_PORT` | `16432` |
| `TOP_KAFKA_HLF_HOST_PORT` | `9094` |
| `TOP_KAFKA_EVENTS_HOST_PORT` | `9095` |
| `TOP_REDIS_HOST_PORT` | `16379` |
| `TOP_ZOOKEEPER_HLF_HOST_PORT` | `2181` |
| `TOP_ZOOKEEPER_EVENTS_HOST_PORT` | `2182` |

## Fabric network (`fabric/network/.env`)

Copy from `fabric/network/.env.example`. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FABRIC_CHANNEL` | `roadwatch-india` | Channel name |
| `FABRIC_CHAINCODE` | `complaint-anchor` | Chaincode to deploy |
| `FABRIC_LEDGER_STATE_DB` | `goleveldb` | `goleveldb` or `CouchDB` |
| `FABRIC_CC_VERSION` | `0.0.1` | Chaincode version |
| `FABRIC_CC_SEQUENCE` | `1` | Chaincode sequence |

## Security notes

- `.env`, `**/.env`, and `SECRETS.md` are gitignored.
- `.env.example` files are committed as templates with placeholder values.
- Use `ALLOW_DEV_OTP_ECHO=true` only in local development.
- Restrict `GEMINI_API_KEY` by app fingerprint in production (see [AI agent workflow](../workflows/ai-agent.md)).
