**Provider: redis**

Summary
- Package: `@roadwatch/redis` — thin wrapper around `@upstash/redis` for cache and ephemeral storage.

Why these choices
- **Upstash Redis**: serverless Redis offering that removes operational overhead for small deployments and provides HTTP-friendly clients. Rationale: easy to manage during development and small production footprints.

Pros
- Minimal operational overhead, straightforward API, good fit for caching and short-lived state.

Cons / Tradeoffs
- Upstash-specific APIs and pricing model can create lock-in. For high-throughput or complex data needs, managed Redis (AWS Elasticache, Azure Cache) or self-hosted Redis may be preferable.

Files of interest
- `providers/redis/package.json` — lists `@upstash/redis`.

Recommendation / Alternatives
- Keep provider adapter thin and abstract the Redis client usage behind the `@roadwatch/redis` API to allow swapping implementations.

Tradeoffs summary: Upstash chosen for low ops cost but abstractions should be maintained to avoid lock-in.
