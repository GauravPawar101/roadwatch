**Service: scheduler**

Summary
- Language/runtime: TypeScript on Node.js.
- Purpose: run scheduled jobs (cron-like tasks) for the system — e.g., polling, cleanup, or periodic data processing.

Why these choices
- **TypeScript / Node.js**: keeps language consistent with other services for shared types and developer ergonomics.
- **node-cron**: lightweight cron scheduling in-process; avoids external scheduler dependencies for simple recurring tasks.
- **pg (Postgres)**: used for durable scheduling metadata (locks, last-run times) to avoid duplicated work in multi-instance deployments.
- **dotenv**: local config convenience.

Pros
- Low overhead to implement and maintain scheduled tasks.
- Using DB-backed locks (Postgres) prevents duplicate runs across scaled instances.
- Fast iteration with `tsx` in dev.

Cons / Tradeoffs
- In-process cron can drift under heavy load or node restarts; distributed schedules at scale may require external schedulers (Kubernetes CronJobs, Airflow, or a dedicated scheduler service).
- Node process needs monitoring and restart strategy for reliability.

Recommendation / Alternatives
- For simple periodic work, current approach is fine. For many or complex jobs, migrate scheduling orchestration to a dedicated scheduler (e.g., Airflow, Temporal, or Kubernetes CronJobs) and keep business logic in this service.

Files of interest
- `services/scheduler/package.json` — lists `node-cron`, `pg`.

Tradeoffs summary: in-process scheduling is simple and fast to ship but trades reliability and precise scheduling guarantees at scale.
