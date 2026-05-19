**Service: fabric-anchor-consumer**

Summary
- Language/runtime: TypeScript running on Node.js (ESM).
- Purpose: consume anchor events from Kafka and anchor them to Hyperledger Fabric via the Fabric Gateway.

Why these choices
- **TypeScript / Node.js**: the service uses the same language/tooling as other app code in the monorepo which enables reuse of shared types and faster developer onboarding. It integrates well with `tsx` for lightweight dev runs and `tsc` for type checks.
- **@upstash/kafka / kafkajs**: chosen for Kafka connectivity and for compatibility with both managed Kafka and local setups. `kafkajs` is a mature, well-documented Node client.
- **@grpc/grpc-js & @hyperledger/fabric-gateway**: required to talk to Fabric Gateway with gRPC in JS/TS — Fabric provides official support here.
- **pg (Postgres)**: service persists state or metadata in Postgres; matches the repo's relational datastore choice.
- **dotenv**: ease of local configuration via `.env` files.

Pros
- Fast developer iteration with `tsx` and TypeScript.
- Shared types and packages across repo reduce duplication.
- Good Fabric integration via official JS gateway libraries.

Cons / Tradeoffs
- Running Fabric and Kafka locally increases environment complexity for contributors.
- Node/TS is less memory- and CPU-efficient than a compiled language (Go, Rust) for long-running heavy workloads.
- Using `@upstash/kafka` (managed-focused) can create divergent code paths between local and managed Kafka setups; tests must cover both.

Recommendation / Alternatives
- If Fabric anchoring becomes CPU- or memory-bound, consider extracting the Fabric gateway interactions into a Go microservice for better throughput and lower memory overhead.
- For simpler deployments, replace managed-Kafka-specific client code with plain `kafkajs` to avoid provider lock-in.

Files of interest
- `services/fabric-anchor-consumer/package.json` — lists `@hyperledger/fabric-gateway`, `kafkajs`, `pg`.

Tradeoffs summary: TypeScript chosen for DX and reuse; it trades runtime efficiency and adds local infra complexity but keeps dev velocity high.
