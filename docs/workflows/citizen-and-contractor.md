# Citizen and Contractor

Workflows for citizens filing complaints and contractors completing repair work.

## Citizen workflow

### Registration and login

1. Request OTP with phone, email, or username.
2. Verify OTP → receive JWT.
3. Access citizen dashboard at `/dashboard/citizen`.

### File a complaint

See [Complaint lifecycle](./complaint-lifecycle.md) for the full flow. Citizens can:

- File via web wizard or mobile app
- Attach photos and GPS location
- Track status in real time (SSE updates)
- Earn karma points for valid submissions

### Karma system

Citizens earn karma for:

- Filing valid complaints (verified by authority)
- Providing useful photos/descriptions
- Confirming resolution

Karma is recalculated by the scheduler cron job and displayed on the citizen dashboard.

### Track complaints

- Dashboard: list of own complaints with status badges
- Detail view: timeline of status changes, anchor tx hash
- Public tracking link (shareable, no login required)

## Contractor workflow

### Access

Contractors log in with company credentials (see [Test credentials](../reference/test-credentials.md)). Access is scoped to assigned roads and work orders.

### Dashboard routes

| Path | Purpose |
|------|---------|
| `/dashboard/contractor` | Main contractor dashboard |
| `/contractor/work-orders` | Assigned repair tasks |
| `/contractor/repair-proofs` | Submit before/after evidence |

### Repair proof submission

1. View assigned work orders from authority.
2. Navigate to complaint location.
3. Capture before-photo (if not already on file).
4. Complete repair work.
5. Capture after-photo with GPS and timestamp.
6. Submit repair proof:

```
POST /contractor/repair-proofs
Authorization: Bearer <contractor-jwt>

{
  "complaintId": "...",
  "beforePhotoUrl": "...",
  "afterPhotoUrl": "...",
  "description": "Pothole filled with hot mix",
  "completedAt": "2026-08-09T10:00:00Z"
}
```

7. Authority verifies and resolves the complaint.

### Work order lifecycle

| Status | Meaning |
|--------|---------|
| `assigned` | Authority assigned work to contractor |
| `in_progress` | Contractor started work |
| `proof_submitted` | Repair proof uploaded |
| `verified` | Authority confirmed repair |
| `rejected` | Authority rejected proof (re-work needed) |

## Mobile app

Citizens use the React Native app for:

- Map view with nearby complaints (`@roadwatch/feature-map`)
- Quick complaint filing with camera (`@roadwatch/feature-complaint`)
- AI assistant for guidance (`@roadwatch/feature-agent`)
- Offline queue for submissions without connectivity

## Related docs

- [Complaint lifecycle](./complaint-lifecycle.md)
- [Mobile host](../services/mobile-host.md)
- [Notifications](./notifications.md)
