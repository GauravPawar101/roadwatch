# Notifications

How RoadWatch delivers notifications across push, SMS, and in-app channels.

## Notification types

| Type | Trigger | Channel |
|------|---------|---------|
| Complaint acknowledged | Authority acknowledges | In-app, push |
| Status changed | Any status transition | In-app, push, SSE |
| Assignment | Inspector/contractor assigned | In-app, push |
| Resolution | Complaint resolved | In-app, push |
| Escalation | SLA breach or manual escalation | In-app, push, SMS |
| RTI response | Authority responds to RTI | In-app, email |
| Anchor confirmed | Fabric tx committed | In-app (tx hash) |

## Pipeline

```
Event occurs (complaint status change, escalation, etc.)
    │
    ▼
Gateway or scheduler emits notification-send to kafka-events
    │
    ▼
webhook-handler: handleNotificationSend
    ├─ INSERT notifications table
    ├─ Check user notification_preferences
    ├─ FCM push (if enabled and token registered)
    ├─ SMS (if enabled and phone available)
    └─ SSE broadcast (if client connected)
```

## User preferences

Users configure notification channels at `/notifications/preferences`:

| Channel | Config |
|---------|--------|
| In-app | Always on |
| Push (FCM) | Opt-in, requires device token |
| SMS | Opt-in, requires verified phone |
| Email | Opt-in, requires verified email |

## Real-time updates (SSE)

The gateway maintains SSE connections for connected web clients. When a notification is created, it is pushed immediately without polling.

Mobile clients use FCM (Firebase Cloud Messaging) for push notifications when the app is backgrounded.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `FCM_SERVER_KEY` | Firebase push notifications |
| `SMS_PROVIDER_*` | SMS gateway configuration |
| `TWILIO_*` | Alternative SMS provider |

## Related docs

- [Webhook handler](../services/webhook-handler.md)
- [Event pipeline](../architecture/event-pipeline.md)
- [Complaint lifecycle](./complaint-lifecycle.md)
