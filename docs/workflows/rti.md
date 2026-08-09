# RTI Workflow

Right to Information (RTI) request handling under India's RTI Act, integrated into RoadWatch as a separate track from complaints.

## Overview

Citizens can file RTI requests to obtain information from road authorities. The system tracks deadlines per Indian RTI rules and supports evidence export.

## States

| State | Meaning |
|-------|---------|
| `draft` | Citizen composing request |
| `filed` | Submitted to authority |
| `acknowledged` | Authority received |
| `response_pending` | Awaiting authority response |
| `responded` | Authority provided response |
| `appealed` | Citizen filed first appeal |
| `closed` | Request completed or withdrawn |

## Flow

```
1. Citizen creates RTI request
   POST /rti
   → rti_requests + computed deadlines (rtiDeadlines.ts)

2. Citizen files request
   POST /rti/:id/file
   → Status: draft → filed
   → Deadlines calculated per India RTI rules:
     - 30 days for normal requests
     - 48 hours for life/liberty matters

3. Authority acknowledges
   POST /authority/rti/:id/acknowledge

4. Authority uploads response
   POST /authority/rti/:id/respond
   → rti_responses table
   → Evidence attachments

5. Optional: first appeal
   POST /rti/:id/appeal

6. Public tracking (opt-in)
   GET /public/rti/:shareToken
   → Redacted public view of request status
```

## Deadline calculation

Implemented in `apps/gateway-api/src/legal/rtiDeadlines.ts` and `packages/adapters/src/india/legal/rti-framework.ts`:

- Standard response: 30 calendar days from filing
- Life/liberty: 48 hours
- Transfer to another authority: resets clock
- First appeal: 30 days from rejection or expiry

## API endpoints

| Method | Path | Role | Action |
|--------|------|------|--------|
| POST | `/rti` | CITIZEN | Create draft |
| POST | `/rti/:id/file` | CITIZEN | File request |
| GET | `/rti/:id` | CITIZEN | View own request |
| GET | `/rti` | CITIZEN | List own requests |
| POST | `/rti/:id/appeal` | CITIZEN | File appeal |
| POST | `/authority/rti/:id/acknowledge` | EE | Acknowledge |
| POST | `/authority/rti/:id/respond` | EE | Upload response |
| GET | `/authority/rti` | EE | List requests in jurisdiction |
| GET | `/public/rti/:shareToken` | Public | Track via share token |

## Evidence export

Authorities and citizens can export RTI evidence packages for legal proceedings. Export includes request text, response documents, and deadline audit trail.

## Related docs

- [Data model](../architecture/data-model.md) — RTI tables
- [Authority portal](./authority-portal.md)
- [Gateway API](../services/gateway-api.md)
