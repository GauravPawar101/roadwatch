# RoadWatch — Privacy, Ledger Boundaries, Retention, and Deletion

This document defines what data is written to the Hyperledger Fabric ledger vs. stored off-ledger, how phone numbers/identity are handled, what “anonymous complaints” means operationally, and the baseline compliance controls for GDPR / PDPA / India DPDP Act.

This is an engineering policy / implementation note, not legal advice.

## 1) What goes on Fabric vs. off-ledger

### Design principle
- Fabric is used as an **immutable audit/anchoring layer**, not as a primary PII datastore.
- Anything that is **directly identifying** (phone number, citizen identity, precise GPS if it can identify a person, message contents, images) should **not** be stored in public world state.
- If Fabric must carry sensitive data for a limited audience, it should be stored in **Private Data Collections (PDCs)** with the narrowest feasible membership.

### Current implementation direction
- **Public Fabric world state** stores:
  - Complaint ID
  - Road/segment ID (or jurisdiction IDs)
  - Authority org
  - Status + timestamps
  - `DetailsHash`: a commitment hash anchoring the full complaint payload stored off-ledger
- **Fabric PDC (PII)** stores (when used):
  - Citizen pseudonymous identifier (not phone)
  - Precise location string
  - Evidence pointers (e.g. IPFS CID) if you choose to keep them on-chain-but-private

In this repo, the chaincode was updated so the public asset no longer stores `CitizenID`, `Location`, or IPFS CIDs directly; those are written to the `citizenPIICollection` PDC when provided.

### Recommended “anchor” payload
Off-ledger system stores the full complaint record. Fabric stores only:
- `DetailsHash = SHA-256(canonical_json(full_complaint_without_runtime_fields))`

This supports:
- tamper evidence (you can prove an off-ledger record existed unchanged)
- right-to-deletion (you can delete off-ledger PII while keeping a non-PII commitment)

## 2) Phone number handling

### Storage goals
- Never store plaintext phone numbers where they are not required.
- Support:
  - OTP login lookup
  - notifications (SMS/WhatsApp) where enabled
  - role assignment by admins

### Pattern
- `phone_hash`: HMAC-SHA256(normalized E.164 phone, server-side pepper) for lookups/uniqueness.
- `phone_enc`: AES-256-GCM encrypted normalized E.164 phone for “need-to-send” operations (SMS/WhatsApp).
- `phone_masked` + `phone_last4`: display only.

### Where stored
- Gateway Postgres (`apps/gateway-api`) stores `phone_hash`, `phone_enc`, `phone_masked`.
- OTP sessions store `phone_hash` (not plaintext) and only masked phone for logs/UI.
- JWT contains masked phone and phone hash (pseudonymous) to support audit correlation without revealing the number.

## 3) Anonymous complaint option

### Definition
An “anonymous complaint” means **the authority cannot see the citizen’s identity/contact**.

Operationally:
- The complaint can still be escalated/resolved based on the complaint ID, location/road context, and evidence.
- Citizen follow-up happens via:
  - in-app updates / push topics, or
  - a citizen-held “case token” (if implemented) that allows two-way messaging without revealing phone.

### Escalation without identity
- Escalation is driven by the complaint record and SLA clocks, not by user identity.
- If authority needs more info, they can request it through the system; the citizen can opt-in to respond.

## 4) GDPR / PDPA / India DPDP Act compliance baseline

### Common requirements across these regimes
- Purpose limitation & data minimization
- Security safeguards
- Access controls & auditability
- Retention limitation
- User rights (access, correction, deletion/erasure where applicable)

### Implementation controls (minimum)
- Encrypt PII at rest (DB + backups)
- Hash-based lookup keys for phone numbers
- Least-privilege access to audit and PII data
- Structured retention schedules + purge jobs
- Right-to-deletion workflow with ledger-safe anchoring

## 5) Right to deletion (account deletion) and anchored complaints

### Core rule
Deletion should remove **direct identifiers** and **linkability**, while preserving legally-required operational records.

Recommended behavior:
- Delete or irreversibly anonymize:
  - citizen account record
  - phone encryption material (encrypted phone)
  - notification inbox/preferences
- Keep non-identifying complaint records needed for public interest / legal obligation:
  - complaint status timeline
  - the Fabric `DetailsHash` anchor

If complaints are anchored on Fabric without PII:
- you can keep the anchor intact while deleting off-ledger PII.
- the ledger record remains meaningful for integrity/audit, but does not expose the person.

## 6) Citizen data visible to authority

Minimum authority view (recommended):
- complaint ID, district/zone/road, description (redacted if needed), status, timestamps
- **no phone number**, no citizen ID, no contact details

If you need a “contactable” mode:
- make it explicit opt-in, and expose only a proxy channel (in-app messaging), not the phone number.

## 7) Data retention policy (baseline)

These are suggested defaults; tune to legal/regulatory requirements per jurisdiction.

- OTP sessions: 7 days max (ideally 24 hours) and purge used/expired.
- Notification deliveries: 30–90 days (operational debugging).
- Notification inbox/history: 180 days (user experience), then archive/anonymize.
- Audit log:
  - 1–3 years typical for operational audit (or longer if required).
  - store masked identifiers only.
- Complaints:
  - resolved complaints: keep 1–5 years depending on agency policy.
  - keep PII for the minimum necessary; after closure + retention window, anonymize and keep only aggregates/anchors.

## 8) Audit log access

Principle:
- Audit trail is sensitive (it reveals who did what, when).

Recommended access control:
- CE (central/admin) can view system audit.
- EE can view only complaint-scoped audit entries for their jurisdiction (optional future refinement).

In this repo, the gateway audit endpoint was tightened to CE-only and returns masked actor identifiers.
