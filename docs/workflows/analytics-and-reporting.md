# Analytics and Reporting

Public dashboards, authority analytics, and ministry report generation.

## Public dashboard

Accessible without login at `/public`:

| Endpoint | Data |
|----------|------|
| `GET /public/dashboard` | Aggregate complaint stats, resolution rates |
| `GET /public/chronic-roads?days=60` | Roads with recurring complaints |
| `GET /public/complaints/:trackingToken` | Track a single complaint |

The public dashboard shows anonymized, aggregated data — no PII is exposed.

## Authority analytics

Available to EE and CE roles at `/authority/analytics`:

- Complaint volume by category, severity, time period
- Resolution time distribution
- District comparison charts
- Inspector workload and performance
- Contractor completion rates

### Pre-computed snapshots

The scheduler generates analytics snapshots on a cron schedule, stored in `analytics_snapshots`. The dashboard reads from snapshots for fast load times, with real-time fallback for recent data.

## Chronic roads

Roads with repeated complaints over a configurable window are flagged as "chronic." The system:

1. Aggregates complaint counts per road segment over N days.
2. Ranks by frequency and severity.
3. Exposes via `GET /public/chronic-roads` and authority analytics.

## Ministry reports

CE role only. Generates PDF reports for ministry-level oversight:

```
GET /reports/ministry.pdf
Authorization: Bearer <ce-jwt>
```

Report contents:

- State/district complaint summary
- Resolution rate trends
- Budget allocation vs. repair completion
- Escalation statistics
- Chronic road list

## Data sources

| Source | Used for |
|--------|----------|
| `complaints` table | Raw complaint data |
| `analytics_snapshots` | Pre-computed metrics |
| `chronic_roads` | Materialized chronic road list |
| `citizen_karma` | Citizen engagement metrics |
| Fabric ledger | Anchor verification counts |

## Related docs

- [Authority portal](./authority-portal.md)
- [Scheduler](../services/scheduler.md)
- [Frontend](../services/frontend.md)
