# Authority Portal

Web dashboard for road authority officials (EE) and chief engineers (CE) to manage complaints, analytics, and reports.

## Access

| Role | Code | Scope |
|------|------|-------|
| Executive Engineer | `EE` | Single state/district jurisdiction |
| Chief Engineer | `CE` | All states/districts (super-admin) |

Login via OTP at `/` using seeded credentials (see [Test credentials](../reference/test-credentials.md)).

## Dashboard routes

| Path | Purpose |
|------|---------|
| `/dashboard/authority` | Main authority dashboard |
| `/authority/complaints` | Complaint triage queue |
| `/authority/analytics` | District-level analytics |
| `/authority/reports` | Generate and download reports |
| `/authority/roads` | Road administration |
| `/authority/notifications` | Notification center |
| `/authority/performance` | Inspector/contractor performance |
| `/authority/rti` | RTI request management |

## Key workflows

### Complaint triage

1. View incoming complaints filtered by jurisdiction.
2. Acknowledge valid complaints.
3. Assign to inspector or contractor.
4. Monitor progress and verify repair proofs.
5. Resolve or escalate as needed.

### Analytics

- Complaint volume by category, severity, road
- Resolution time trends
- Chronic road identification
- Contractor performance metrics

### Ministry reports

CE role can generate ministry PDF reports:

```
GET /reports/ministry.pdf
Authorization: Bearer <ce-jwt>
```

### Road administration

- View and edit road segments in jurisdiction
- Assign roads to contractors
- Update authority mappings (NHAI/PWD)

## API surface

All authority endpoints are under `/authority/*` in the gateway API. See [Gateway API](../services/gateway-api.md) for the full route list.

## Frontend components

Key directories in `frontend/src/authority/`:

- Complaint list and detail views
- Assignment dialogs
- Analytics charts
- Report generation UI
- RTI management panels

## Related docs

- [Complaint lifecycle](./complaint-lifecycle.md)
- [Analytics and reporting](./analytics-and-reporting.md)
- [RTI workflow](./rti.md)
- [Frontend](../services/frontend.md)
