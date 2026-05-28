**Service: webhook-handler**

Summary
- Language/runtime: TypeScript on Node.js.
- Purpose: receive external webhooks, perform light processing, publish events to Kafka, and call external endpoints as-needed.

Why these choices
- **TypeScript / Node.js**: shared stack benefits; fast HTTP handling and many webhook client libraries in Node.
- **kafkajs**: publish events to Kafka for downstream processing; `kafkajs` is stable and well-supported.
- **axios**: HTTP client for outgoing webhook calls and callback requests; lightweight and familiar.
- **pg**: store webhook receipts, idempotency keys, or audit logs.
- **dotenv**: configuration convenience.

Pros
- Rapid development and testing of webhook handlers.
- Easy integration with existing Kafka and Postgres used across the repo.

Cons / Tradeoffs
- Handling large concurrent incoming webhook traffic requires careful scaling and backpressure (e.g., using a queue for downstream processing). Node.js single-threaded model requires design for CPU-bound tasks.
- Reliance on external HTTP calls (axios) introduces network error handling complexity and retries.

Recommendation / Alternatives
- For very high webhook throughput, consider a lightweight ingress layer (NGINX / API Gateway) + worker pool pattern; persist idempotency in Postgres to avoid duplicates.

Files of interest
- `services/webhook-handler/package.json` — lists `kafkajs`, `pg`, `axios`.

Tradeoffs summary: Node/TS offers developer velocity; scale concerns are manageable with queueing and horizontally scaling workers.
