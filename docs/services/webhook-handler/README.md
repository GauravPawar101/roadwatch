# Webhook Handler

**Package:** `@roadwatch/webhook-handler`

**Role:** Kafka consumer that applies downstream side effects from complaint lifecycle events.

## Current Version And Stack

- KafkaJS `2.2.4`
- Axios `1.7.7`
- PostgreSQL `pg` `8.13.1`
- `dotenv` `16.6.1`
- `tsx` for local execution

## Topics Consumed

 `complaint-submitted`
 `complaint-anchored`
 `complaint-status-changed`
 `notification-send`
 `authority-action`

## Main Flow

1. The service connects to PostgreSQL and Kafka.
2. It subscribes to the complaint lifecycle topics.
3. Each handler updates complaint state, notification records, or audit logs.
4. It writes all derived state back into the shared database.

## State In The Repo

- This service is active and part of the root runtime.
- It is the main fan-out point for Kafka-driven side effects.