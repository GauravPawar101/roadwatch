**Provider: kafka**

Summary
- Package: `@roadwatch/kafka` — Node library wrappers around Kafka clients (`kafkajs`, `@upstash/kafka`).

Why these choices
- **kafkajs**: mature, pure-JS Kafka client that works in Node environments with broad feature support.
- **@upstash/kafka**: included for managed/Upstash compatibility and to simplify connections to hosted Kafka offerings.

Pros
- Flexible support for both local/self-hosted Kafka and managed Kafka offerings.

Cons / Tradeoffs
- Managing provider-specific codepaths increases maintenance burden. Using Upstash-specific features can create coupling to that provider.

Files of interest
- `providers/kafka/package.json` — shows `kafkajs` and `@upstash/kafka`.

Recommendation / Alternatives
- Prefer using `kafkajs` APIs and keep Upstash usage as an adapter layer to avoid lock-in.

Tradeoffs summary: balance between supporting managed Kafka conveniences and keeping codebase portable.
