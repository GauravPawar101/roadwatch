**Service: gateway-api**

Summary
- Language/runtime: TypeScript on Node.js (Express).
- Purpose: primary HTTP API gateway for backend operations, authentication, document generation, and integration with Fabric and other services.

Why these choices
- **TypeScript / Node.js / Express**: consistent with other services for type sharing; Express is lightweight and widely used for REST APIs. The `gateway-api` depends on `pg`, `zod`, `jsonwebtoken`, and Kafka/Redis providers to integrate with the platform.

Pros
- Rapid iteration and testability with `tsx` and `vitest`.
- Large ecosystem of middleware (auth, file handling, validation).

Cons / Tradeoffs
- Single-threaded Node model requires careful handling for CPU-heavy tasks (offload to workers or native services). Complex deployment needs proper process managers and autoscaling.

Files of interest
- `apps/gateway-api/package.json` — shows dependencies and dev tooling.

Recommendation / Alternatives
- If API latency or CPU-bound processing grows, isolate heavy jobs into worker services (e.g., Node workers, Go services, or serverless functions).

Tradeoffs summary: selected for developer productivity and ecosystem; may require architectural changes at high scale.
