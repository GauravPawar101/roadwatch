**Provider: kafka**

Summary
- Package: `@roadwatch/kafka` — Node library wrappers around the KafkaJS client.
- **Location:** `packages/kafka/` (previously `providers/kafka/` at repo root, outside the pnpm workspace).

Why these choices
- **kafkajs**: mature, pure-JS Kafka client that works in Node environments with broad feature support.

Pros
- Self-contained, properly workspace-registered package.
- Works with both local Docker Kafka and any KafkaJS-compatible managed broker.

Cons / Tradeoffs
- No built-in Upstash-specific client anymore; use standard KafkaJS APIs for all environments.

Files of interest
- `packages/kafka/package.json` — lists `kafkajs`.

Recommendation / Alternatives
- Use `kafkajs` APIs throughout; avoid adding provider-specific SDKs to keep the package portable.

Tradeoffs summary: KafkaJS only, avoiding managed-provider lock-in.
