# Frontend

React + Vite web application serving all user roles and public dashboards.

## Details

| Property | Value |
|----------|-------|
| Package | `roadwatch-frontend` |
| Entry | `frontend/src/main.tsx` → `App.tsx` |
| Port | `5173` (`VITE_PORT`) |
| Dev command | `pnpm dev:frontend` |

## Route structure

| Path | Role | Pages |
|------|------|-------|
| `/` | Public | Landing, login |
| `/public` | Public | Analytics dashboard, chronic roads |
| `/dashboard/citizen` | CITIZEN | Complaint wizard, tracking, karma |
| `/dashboard/authority` | EE/CE | Triage, assignments, analytics |
| `/dashboard/contractor` | CONTRACTOR | Work orders, repair proofs |
| `/dashboard/admin` | CE | User management, system config |
| `/authority/*` | EE/CE | Authority-specific workflows |
| `/rti/*` | Mixed | RTI filing and tracking |

## Key features

- Role-based route guards (`AuthorityGuard`, `CitizenGuard`, etc.)
- Complaint wizard with map-based location picker
- Real-time status updates via SSE
- Public analytics dashboard (no login required)
- Ministry report generation (CE role)
- Service registry registration on dev startup

## Environment

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE` | Gateway API URL |
| `VITE_PORT` | Dev server port |
| `GATEWAY_URL` | For service registration |
| `SERVICE_REGISTRY_SECRET` | Service auth |

## Build

```powershell
pnpm build:frontend
```

Production build outputs static files served by nginx in k8s Layer 4.

## Key source directories

| Directory | Purpose |
|-----------|---------|
| `src/pages/` | Page components per role |
| `src/authority/` | Authority portal components |
| `src/components/` | Shared UI components |
| `src/hooks/` | API hooks, SSE, auth |

## Related workflows

- [Authority portal](../workflows/authority-portal.md)
- [Citizen and contractor](../workflows/citizen-and-contractor.md)
- [Analytics and reporting](../workflows/analytics-and-reporting.md)
