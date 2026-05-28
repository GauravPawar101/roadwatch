# Scheduler

**Package:** `@roadwatch/scheduler`

**Role:** cron-based maintenance service for offline queue sync, karma recalculation, SLA breach detection, audit cleanup, and daily reporting.

## Current Version And Stack

- `node-cron` `3.0.3`
- PostgreSQL `pg` `8.13.1`
- `dotenv` `16.6.1`
- `tsx` for local execution

## Scheduled Jobs

- Offline queue sync: every 5 minutes.
- Karma recalculation: every hour.
- SLA breach detection: every 30 seconds.
- Audit log cleanup: daily at 2 AM.
- Report generation: daily at 1 AM.

## Main Flow

1. The service starts and validates database connectivity.
2. It registers each cron job with the configured schedule.
3. Each job reads or writes the shared PostgreSQL state used by the rest of the app.
4. The service runs continuously and exits only on signal.

## State In The Repo

- This service is active and part of the root runtime.
- It is the main place to read background maintenance behavior.