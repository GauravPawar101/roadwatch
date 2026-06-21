**Provider: redis**

Summary
- Package: `@roadwatch/redis` — thin wrapper around `ioredis` for cache, idempotency, and backpressure.
- **Location:** `packages/redis/` (previously `providers/redis/` at repo root, outside the pnpm workspace).

Why these choices
- **ioredis**: Docker-backed Redis for development and repeatable local deployments. Keeps the runtime simple and matches the repo's local-first setup.

Pros
- Minimal operational overhead, straightforward API, good fit for caching and short-lived state.
- Now a proper workspace member — importable by other packages via `@roadwatch/redis`.

Cons / Tradeoffs
- For high-throughput or complex data needs, managed Redis (AWS Elasticache, Azure Cache) or self-hosted Redis cluster may be preferable.

Files of interest
- `packages/redis/package.json` — lists `ioredis`.

Recommendation / Alternatives
- Keep the provider adapter thin and abstract the Redis client usage behind the `@roadwatch/redis` API to allow swapping implementations.

Tradeoffs summary: ioredis chosen for simplicity and local-first dev; abstraction layer maintained to avoid lock-in.
