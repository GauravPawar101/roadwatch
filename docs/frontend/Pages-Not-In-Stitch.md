# Pages Pending Stitch Upload

Overview
- This file lists frontend pages that appear to be missing from Stitch (or are not documented in `docs/frontend`) and the pages you asked to fetch from Stitch. Use this as a checklist for what to upload or sync to the Stitch project.

Pages present in repo but not referenced in `docs/frontend` (likely not uploaded to Stitch)
- [frontend/src/pages/AgentChat.tsx](frontend/src/pages/AgentChat.tsx#L1)
- [frontend/src/pages/BudgetHistory.tsx](frontend/src/pages/BudgetHistory.tsx#L1)
- [frontend/src/pages/Escalation.tsx](frontend/src/pages/Escalation.tsx#L1)
- [frontend/src/pages/auth/ContractorSignup.tsx](frontend/src/pages/auth/ContractorSignup.tsx#L1)
- [frontend/src/pages/auth/ContractorLogin.tsx](frontend/src/pages/auth/ContractorLogin.tsx#L1)
- [frontend/src/pages/auth/CitizenSignup.tsx](frontend/src/pages/auth/CitizenSignup.tsx#L1)
- [frontend/src/pages/auth/CitizenLogin.tsx](frontend/src/pages/auth/CitizenLogin.tsx#L1)
- [frontend/src/pages/auth/AuthoritySignup.tsx](frontend/src/pages/auth/AuthoritySignup.tsx#L1)
- [frontend/src/pages/auth/AuthorityLogin.tsx](frontend/src/pages/auth/AuthorityLogin.tsx#L1)

Pages you asked to fetch from Stitch (status)
- frontend/src/pages/CommandCenter.tsx : Exists — documented in `docs/frontend/Super-Admin.md`. ([link](frontend/src/pages/CommandCenter.tsx#L1))
- frontend/src/pages/superAdmin/AuditPolicy.tsx : Missing in repo — create or upload to repository before Stitch sync.
- frontend/src/pages/superAdmin/AnalyticsOversight.tsx : Missing in repo — create or upload to repository before Stitch sync.
- frontend/src/pages/superAdmin/CredentialManagement.tsx : Missing in repo — create or upload to repository before Stitch sync.
- frontend/src/pages/dashboard/SuperAdminDashboard.tsx : Exists — documented. ([link](frontend/src/pages/dashboard/SuperAdminDashboard.tsx#L1))
- frontend/src/pages/SyncStatus.tsx : Exists — documented. ([link](frontend/src/pages/SyncStatus.tsx#L1))
- frontend/src/pages/Settings.tsx : Exists — documented. ([link](frontend/src/pages/Settings.tsx#L1))

Notes & next steps
- Confirm the Stitch project ID and whether you want files overwritten when syncing.
- For the missing `superAdmin/*` pages: either create them in `frontend/src/pages/superAdmin/` or tell me which existing files they map to so I can prepare them for Stitch.
- I can: 1) generate a simple stub for each missing page in the repo, or 2) attempt to fetch from Stitch (requires project ID and existing screens).

If you'd like, I can now:
- create stubs for the missing `superAdmin` pages, or
- attempt to connect to Stitch (using `.env` API key) and list project screens so you can pick which to import.
