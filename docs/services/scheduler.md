# Scheduler

Cron-based background worker for time-triggered tasks: SLA checks, karma updates, audit cleanup, and report generation.

## Details

| Property | Value |
|----------|-------|
| Package | `@roadwatch/scheduler` |
| Entry | `services/scheduler/index.ts` |
| Dev command | `pnpm dev:scheduler` |
| HTTP server | None (cron only) |

## Cron jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| SLA check | Configurable (`CRON_SLA_CHECK`) | Detect overdue complaints, emit `escalation-due` |
| Karma update | Configurable (`CRON_KARMA`) | Recalculate citizen karma scores |
| Audit cleanup | Configurable (`CRON_AUDIT_CLEANUP`) | Prune old audit log entries |
| Report generation | Configurable (`CRON_REPORTS`) | Pre-compute analytics snapshots |
| Offline queue sync | Configurable (`CRON_OFFLINE_SYNC`) | Process queued offline submissions |

## Deployment note

In Kubernetes, the scheduler runs as a **StatefulSet with replicas=1**. A Deployment with replicas > 1 would double-fire every cron job.

## Environment

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres |
| `GATEWAY_URL` | API calls for escalation |
| `SERVICE_NAME` | `scheduler` |
| `CRON_*` | Per-job cron expressions |

## Docker

Runs as `roadwatch_scheduler` in the default Docker Compose stack.

## Related docs

- [Complaint lifecycle](../workflows/complaint-lifecycle.md)
- [Analytics and reporting](../workflows/analytics-and-reporting.md)
