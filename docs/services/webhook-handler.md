# Webhook Handler

Consumes events from the **kafka-events** cluster and fans out to database updates, notifications, and audit logging.

## Details

| Property | Value |
|----------|-------|
| Package | `@roadwatch/webhook-handler` |
| Entry | `services/webhook-handler/index.ts` |
| Dev command | `pnpm dev:webhook` |
| HTTP server | None (Kafka consumer only) |

## Consumed topics

| Topic | Handler | Action |
|-------|---------|--------|
| `complaint-submitted` | `handleComplaintSubmitted` | Audit log, notification queue |
| `complaint-anchored` | `handleComplaintAnchored` | Update complaint with tx hash |
| `complaint-status-changed` | `handleStatusChanged` | Audit log, notification |
| `notification-send` | `handleNotificationSend` | Deliver notification |
| `authority-action` | `handleAuthorityAction` | Audit log |
| `escalation-due` | `handleEscalationDue` | Trigger escalation workflow |
| `media-uploaded` | `handleMediaUploaded` | Update complaint media refs |
| `media-analyzed` | `handleMediaAnalyzed` | Store analysis results |

## Environment

| Variable | Purpose |
|----------|---------|
| `KAFKA_EVENTS_BROKERS` | Events cluster (`127.0.0.1:9095`) |
| `KAFKA_GROUP_ID` | Consumer group |
| `REDIS_URL` | DB 1 — transient cache |
| `DATABASE_URL` | Postgres |
| `GATEWAY_URL` | Service registration |

## Docker

Runs as `roadwatch_webhook_handler` in the default Docker Compose stack.

## Related docs

- [Notifications workflow](../workflows/notifications.md)
- [Event pipeline](../architecture/event-pipeline.md)
