# Complaint Lifecycle

From citizen submission through authority resolution and optional escalation.

## Flow diagram

```
Citizen files complaint (web or mobile)
    │
    ▼
Gateway API: POST /citizen/complaints
    ├─ Validate input (category, severity, location, media)
    ├─ Geospatial road matching (GPS → nearest road segment)
    ├─ Upload media to Supabase (if photos attached)
    ├─ INSERT complaints + kafka_event_outbox (single transaction)
    └─ Return complaint ID + tracking token
    │
    ▼
Outbox relay → kafka-hlf + kafka-events: complaint-submitted
    │
    ├─► fabric-anchor-consumer → Fabric anchoring (async)
    ├─► webhook-handler → audit log + notification
    └─► SSE → real-time update to connected clients
    │
    ▼
Authority triage (EE in jurisdiction)
    ├─ POST /authority/complaints/:id/acknowledge
    ├─ POST /authority/complaints/:id/assign (inspector or contractor)
    └─ Status: submitted → acknowledged → in_progress
    │
    ▼
Resolution path
    ├─ Contractor submits repair proof → POST /contractor/repair-proofs
    ├─ Authority verifies → POST /authority/complaints/:id/resolve
    └─ Status: in_progress → resolved
    │
    ▼
Escalation path (if SLA breached)
    ├─ Scheduler detects overdue → escalation-due event
    ├─ Authority escalates → POST /authority/complaints/:id/escalate
    └─ Status: → escalated (higher authority notified)
```

## Complaint statuses

| Status | Meaning |
|--------|---------|
| `submitted` | Citizen filed, awaiting authority action |
| `acknowledged` | Authority seen and accepted |
| `in_progress` | Assigned to inspector or contractor |
| `resolved` | Repair verified and closed |
| `rejected` | Invalid or out-of-jurisdiction |
| `escalated` | SLA breached, escalated to higher authority |

## Filing a complaint

### Web (frontend)

1. Navigate to `/dashboard/citizen` or use the complaint wizard.
2. Select category (pothole, drainage, signage, etc.) and severity.
3. Pin location on map or use GPS.
4. Attach photos (optional).
5. Submit — receive tracking ID.

### Mobile

1. Open complaint screen (`@roadwatch/feature-complaint`).
2. Capture photo and GPS automatically.
3. Select category and add description.
4. Submit — queued offline if no connectivity.

### API

```
POST /citizen/complaints
Authorization: Bearer <citizen-jwt>
Content-Type: application/json

{
  "category": "pothole",
  "severity": "high",
  "description": "...",
  "latitude": 28.6139,
  "longitude": 77.2090,
  "mediaUrls": ["https://..."]
}
```

## Authority actions

| Action | Endpoint | Role |
|--------|----------|------|
| List complaints in jurisdiction | `GET /authority/complaints` | EE |
| Acknowledge | `POST /authority/complaints/:id/acknowledge` | EE |
| Assign inspector | `POST /authority/complaints/:id/assign` | EE |
| Update status | `PATCH /authority/complaints/:id/status` | EE |
| Resolve | `POST /authority/complaints/:id/resolve` | EE |
| Escalate | `POST /authority/complaints/:id/escalate` | EE |
| Reject | `POST /authority/complaints/:id/reject` | EE |

## SLA and escalation

The scheduler runs SLA checks on a cron schedule. When a complaint exceeds its SLA window:

1. Scheduler emits `escalation-due` to kafka-events.
2. Webhook handler creates escalation notification.
3. Authority can manually escalate via API.
4. Escalation history is queryable on Fabric (with CouchDB enabled).

## Tracking

Citizens track complaints via:

- Web dashboard: `/dashboard/citizen`
- API: `GET /citizen/complaints/:id`
- Public tracking (no login): `GET /public/complaints/:trackingToken`

## Related docs

- [Blockchain anchoring](./blockchain-anchoring.md)
- [Authority portal](./authority-portal.md)
- [Notifications](./notifications.md)
- [Data model](../architecture/data-model.md)
