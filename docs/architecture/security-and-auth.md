# Security and Authentication

## Authentication model

RoadWatch uses phone/email/username + OTP for login, issuing JWT access and refresh tokens.

### OTP flow

1. Client sends identifier (phone, email, or username) to `POST /auth/otp/request`.
2. Gateway generates OTP, stores in Redis (`otp:*`), optionally sends via SMS provider.
3. In development, `ALLOW_DEV_OTP_ECHO=true` returns the OTP in the API response.
4. Client submits OTP to `POST /auth/otp/verify`.
5. Gateway validates, issues JWT pair, stores refresh token in `sessions` table.

### JWT claims

Access tokens include:

- `sub` — user ID
- `role` — `CITIZEN`, `EE`, `CE`, or `CONTRACTOR`
- `jurisdiction` — state/district scope for authority users
- `exp` — expiry (configurable)

Refresh tokens rotate on use and are invalidated on logout.

### Role-based access

| Route prefix | Required role | Guard |
|--------------|---------------|-------|
| `/citizen/*` | `CITIZEN` | CitizenGuard |
| `/authority/*` | `EE` or `CE` | AuthorityGuard |
| `/contractor/*` | `CONTRACTOR` | ContractorGuard |
| `/admin/*` | `CE` | AdminGuard |
| `/public/*` | None | Public |

## Service-to-service auth (Istio / local)

In Kubernetes, service identity is provided by **Istio Envoy sidecars** (mTLS + SPIFFE ServiceAccounts). AuthorizationPolicies restrict:

- only `gateway` SA → `backend`
- only `scheduler` / `webhook` SAs → gateway `/internal/*`

Locally (`pnpm start:all` / docker-compose), there is no mesh. Workers call gateway `/internal/*` with `INTERNAL_SERVICE_TOKEN` (`x-service-token`). Discovery uses static env URLs / Kubernetes DNS (`GATEWAY_URL`, `BACKEND_URL`).

| Variable | Purpose |
|----------|---------|
| `INTERNAL_SERVICE_TOKEN` | Local shared secret for `/internal/*` |
| `SERVICE_NAME` | Logging identity (optional) |
| `GATEWAY_URL` | Gateway base URL for workers |

## PII protection

| Mechanism | Variable | Purpose |
|-----------|----------|---------|
| Phone hashing | `PHONE_HASH_PEPPER` | One-way hash for lookups |
| Phone encryption | `PHONE_ENC_KEY` | AES encryption for stored phones |
| Fabric PII isolation | Private data collections (planned) | PII never on public ledger |

In development, PII protection vars are optional. Enable them in production.

## Rate limiting

Gateway REST endpoints are rate-limited per IP and per user via Redis counters. OTP requests have additional rate limiting (`otp_rate:*` keys) to prevent brute force.

## Idempotency

Write endpoints accept an `Idempotency-Key` header. Duplicate requests with the same key return the cached response without re-processing.

## Secrets management

| File | Status |
|------|--------|
| `.env` / `**/.env` | Gitignored |
| `.env.example` | Committed (placeholders only) |
| `SECRETS.md` | Gitignored |
| `*.key`, `*.pem` | Gitignored (except Fabric config templates) |
| Fabric `organizations/` | Gitignored (generated crypto material) |

Never commit real API keys, JWT secrets, or Fabric private keys.

## CORS

Backend API and gateway configure `CORS_ORIGIN` to allow the frontend dev server (`http://127.0.0.1:5173`) by default. Production deployments should restrict to the actual frontend domain.

## Mobile API key exposure

`GEMINI_API_KEY` in the mobile app bundle is visible to users. In production:

- Restrict the key to your Android SHA-1 fingerprint and iOS bundle ID in Google Cloud Console.
- Prefer server-side inference via `POST /public/agent/chat` when possible.

## Related docs

- [Gateway API](../services/gateway-api.md)
- [Environment variables](../getting-started/environment-variables.md)
- [Test credentials](../reference/test-credentials.md)
