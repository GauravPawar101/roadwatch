# RTI workflow (legal)

This repo can auto-generate RTI draft text, but also needs a complete **submission + response + escalation + evidence** workflow.

This document describes the minimal RTI workflow implemented in `apps/gateway-api`.

## Goals

- Track RTI submissions **separately** from complaints
- Support response intake (citizen uploads RTI response from the government)
- Calculate statutory deadlines **per country** (starting with India)
- Allow opt-in escalation to NGO/media with an optional public share view
- Export an evidence package suitable for a lawyer or journalist

## Data model (Postgres)

Tables created in `apps/gateway-api/src/db.ts`:

- `rti_requests`
  - Links to a complaint optionally via `complaint_id`
  - Tracks country, authority, subject, request text, status, deadlines
  - Uses `tracking_token` (UUID) for citizen tracking without requiring login
  - Uses `public_share_token` for opt-in public sharing

- `rti_events` (append-only timeline)
- `rti_responses` (uploaded government responses)
- `rti_attachments` (optional evidence files citizen attaches)

## API surface (gateway-api)

### Create an RTI request

- `POST /rti`
  - Body: `countryCode`, `authorityName`, `subject`, `requestText`, optional `complaintId`, `submittedAt`
  - Optional: `status` = `DRAFT|FILED` (defaults to `FILED`)
  - Returns: RTI row + `tracking_token`

### Draft workflow

- Create a draft RTI (no deadlines yet):
  - `POST /rti` with `status: 'DRAFT'`

- Edit a draft RTI before filing:
  - `PUT /rti/:id/draft?token=<tracking_token>`
  - Only allowed while `status = 'DRAFT'`

- File/submit a draft (computes deadlines and transitions to `FILED`):
  - `POST /rti/:id/file?token=<tracking_token>`
  - Optional body: `submittedAt`, `isLifeOrLiberty`

### Track/view an RTI request (citizen)

- `GET /rti/:id?token=<tracking_token>`

### Upload government RTI response

- `POST /rti/:id/response?token=<tracking_token>`
  - `multipart/form-data`
  - Field: `response` (file), optional `notes`

### Attach evidence files (photos/docs)

- `POST /rti/:id/attachments?token=<tracking_token>`
  - `multipart/form-data`
  - Field: `files` (one or more), `kind` = `PHOTO|VIDEO|DOCUMENT`, optional `note`

### Opt-in escalation to NGO/media

- `POST /rti/:id/escalate?token=<tracking_token>`
  - Body: `{ channel: 'NGO'|'MEDIA', makePublic: boolean }`
  - If `makePublic` is true, returns a share URL: `/public/rti/:shareToken`

### Public share view (redacted)

- `GET /public/rti/:shareToken`
  - Returns a redacted view of the RTI request + recent response metadata.

## Deadlines

- Implemented in `apps/gateway-api/src/legal/rtiDeadlines.ts`.
- Current behavior:
  - India (`IN`): default 30 calendar days; 2 days if `isLifeOrLiberty`
  - Fallback: 30 calendar days

This is a **calendar-day** calculator; it does not model weekends/holidays or postal service rules yet.

## Privacy

- `tracking_token` is a bearer secret: treat it like a password.
- Public sharing requires explicit citizen opt-in, and does not expose the tracking token.
