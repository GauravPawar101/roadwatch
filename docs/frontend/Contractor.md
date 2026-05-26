# Contractor — Frontend

Overview
- Role: `contractor` — operational workspace for contractors to receive assignments, upload proof, and manage project delivery.
- Contractor users should be organized by region, project, and approval responsibility so supervisors can inspect delivery progress at a glance.

Pages (frontend files)
- **Dashboard / Command center:** [frontend/src/pages/dashboard/ContractorDashboard.tsx](frontend/src/pages/dashboard/ContractorDashboard.tsx#L1)
- **Assigned works / complaints on my roads:** [frontend/src/contractor/ComplaintsOnMyRoads.tsx](frontend/src/contractor/ComplaintsOnMyRoads.tsx#L1)
- **Complaint detail (contractor view):** [frontend/src/contractor/ComplaintDetail.tsx](frontend/src/contractor/ComplaintDetail.tsx#L1)
- **Progress proof upload:** [frontend/src/contractor/ProgressProofUpload.tsx](frontend/src/contractor/ProgressProofUpload.tsx#L1)
- **Document vault / project details:** [frontend/src/contractor/DocumentVault.tsx](frontend/src/contractor/DocumentVault.tsx#L1), [frontend/src/contractor/ProjectDetail.tsx](frontend/src/contractor/ProjectDetail.tsx#L1)
- **Chat & coordination:** [frontend/src/contractor/AgentChatContractor.tsx](frontend/src/contractor/AgentChatContractor.tsx#L1)
- **Auth / login guard:** [frontend/src/contractor/Login.tsx](frontend/src/contractor/Login.tsx#L1), [frontend/src/contractor/ContractorGuard.tsx](frontend/src/contractor/ContractorGuard.tsx#L1)

Notes
- Contractor flows focus on proof submission, progress updates, and SLA compliance. Key pages are the contractor dashboard and progress upload flows.
- The routed contractor dashboard now includes a regional project map and a delivery trend chart so delivery scope can be reviewed alongside KPI cards.
- Use the dashboard map and profile access to review work regions before opening project proof or work queues.

Suggested contractor hierarchy and visibility
- Regional managers: oversee multiple projects and compare progress across contractor teams.
- Project leads: manage a single project or work package and review assigned complaints, proof, and blockers.
- Field engineers / supervisors: update progress, upload evidence, and coordinate with authority reviewers.
- Each higher-level contractor view should expose subordinate staff contact details, role scope, and work history.
- Each contractor profile should expose `name`, `company`, `gmail`, `phone`, `role`, `region`, `projectCount`, `work history`, and current assignment load.

Contractor visibility constraint
- Contractors should only see engineer-level authority users, not unrelated authority staff.
- The visible authority set should be filtered by the contractor's current work scope and level of assignment.
- If a contractor is assigned to a municipal project, they should only see the municipal engineer or supervisor tied to that project.
- If a contractor is assigned to city/town/village or district work, they should only see the engineers responsible for that level and the projects directly linked to their assignment.
- Contractor views should not expose authority records outside the contractor's allowed jurisdiction, work order, or approval chain.
- Visible engineer records should include `name`, `role`, `gmail`, `phone`, `jurisdiction`, `work history`, and the complaints/projects they supervise.

Suggested shared data structures
- ContractorPerson: {id:string, name:string, company:string, gmail:string, phone:string, role:string, region:string, assignmentLoad:number, workHistory:ContractorWorkHistoryItem[]}
- ContractorWorkHistoryItem: {id:string, title:string, projectId:string, complaintIds:string[], status:string, startDate:string, endDate?:string, notes?:string}
- ContractorProject: {id:string, projectId:string, title:string, region:string, lead:string, status:'Assigned'|'In Progress'|'Pending Approval'|'Resolved', progressPct:number, complaintIds:string[], updatedAt:string}
- ContractorTeamNode: {label:string, role:string, region:string, projectCount:number, openIssues:number, children:ContractorTeamNode[]}

Per-page components and data structures

- Contractor Dashboard -> [frontend/src/pages/dashboard/ContractorDashboard.tsx](frontend/src/pages/dashboard/ContractorDashboard.tsx#L1)
	- components:
		- Header: {title:string, subtitle?:string}
		- WorkQueue: {items: WorkOrder[], onAssign?:fn}
		- SLAWidget: {metrics:{open:number, breaches:number, compliancePct:number}}
		- QuickFilters: {regions?: string[], status?:string}
		- TeamHierarchyPanel: {node:ContractorTeamNode, childNodes:ContractorTeamNode[]}
		- StaffDirectory: {items:ContractorPerson[]}
		- EngineerAccessPanel: {items:{name:string, role:string, gmail:string, phone:string, jurisdiction:string, workHistory:string[]}[]}
		- ProjectPortfolio: {items:ContractorProject[]}
	- data structures:
		- WorkOrder: {id:string, complaintId:string, roadId:string, title:string, assignedAt?:string, dueAt?:string, status:ComplaintStatus, severity:number, contractor:string}
		- EngineerAccessRecord: {name:string, role:string, gmail:string, phone:string, jurisdiction:string, workHistory:string[], complaintIds:string[], projectIds:string[]}
	- layout: top-level KPIs and hierarchy switch at the top, then a split view with delivery progress, staff directory, and project drill-downs

- Complaints On My Roads -> [frontend/src/contractor/ComplaintsOnMyRoads.tsx](frontend/src/contractor/ComplaintsOnMyRoads.tsx#L1)
	- components:
		- RoadGroupList: {groups:{roadId:string, complaints:ComplaintRecord[]}[]}
		- ComplaintRow: {complaint:ComplaintRecord, actions:{uploadProof,updateProgress}}
		- AssignmentContextCard: {project:ContractorProject, lead:ContractorPerson}
	- behavior: show each complaint in the context of the project, owner, and current delivery stage
	- authority linkage: only display the supervising engineer for the complaint's jurisdiction and assigned work level

- Progress Proof Upload -> [frontend/src/contractor/ProgressProofUpload.tsx](frontend/src/contractor/ProgressProofUpload.tsx#L1)
	- components:
		- UploadForm: {workOrderId:string, files:FileMeta[], notes?:string}
		- EvidencePreview: {files:FileMeta[]}
		- SubmitButton: {onSubmit(fn) -> returns ProofRecord}
	- data structures:
		- ProofRecord: {id:string, workOrderId:string, files:FileMeta[], submittedAt:string, uploader:string, status:'Submitted'|'Verified'|'Rejected', notes?:string}
	- layout: upload form on the left, evidence preview on the right, submission summary below

- Document Vault -> [frontend/src/contractor/DocumentVault.tsx](frontend/src/contractor/DocumentVault.tsx#L1)
	- components: VaultList {items: {id,name,uploadedAt,category}}, VaultUpload, DocumentFilter {projectId?, category?, dateRange?}
	- data used: contractor certifications, progress receipts, and assignment files

- Project Detail -> [frontend/src/contractor/ProjectDetail.tsx](frontend/src/contractor/ProjectDetail.tsx#L1)
	- components: ProjectHeader, TaskList {tasks:WorkOrder[]}, Timeline {events:TimelineEvent[]}, StaffDrawer {person:ContractorPerson, workHistory:ContractorWorkHistoryItem[]}
	- staff drawer behavior: if authority contacts are shown, restrict them to the engineer assigned to the project or the next approval level above it
	- layout: project summary at top, task timeline in the center, staff and assignment drill-down in a side rail

Notes: standardize `FileMeta` and `ProofRecord` for proof lifecycle. Keep `WorkOrder` closely mapped to `ComplaintRecord` for traceability.
