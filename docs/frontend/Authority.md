# Authority — Frontend

Overview
- Role: `authority` — jurisdiction control tower for assigning work, verifying evidence, escalating, and reporting.
- Authority is tiered by operating level: municipal, city/town/village, district, and state.
- Higher levels should be able to roll up progress across their jurisdiction and drill into every lower-level user, contractor, and project they oversee.

Pages (frontend files)
- **Dashboard / Command center:** [frontend/src/pages/dashboard/AuthorityDashboard.tsx](frontend/src/pages/dashboard/AuthorityDashboard.tsx#L1)
- **Complaint detail (authority view):** [frontend/src/authority/ComplaintDetail.tsx](frontend/src/authority/ComplaintDetail.tsx#L1)
- **Assign inspector / assign contractor:** [frontend/src/authority/AssignInspector.tsx](frontend/src/authority/AssignInspector.tsx#L1)
- **Proof verification & repair proof wizard:** [frontend/src/pages/ProofVerification.tsx](frontend/src/pages/ProofVerification.tsx#L1), [frontend/src/authority/RepairProofWizard.tsx](frontend/src/authority/RepairProofWizard.tsx#L1)
- **Analytics & district reports:** [frontend/src/authority/Analytics.tsx](frontend/src/authority/Analytics.tsx#L1), [frontend/src/authority/DistrictReport.tsx](frontend/src/authority/DistrictReport.tsx#L1)
- **Notifications & performance evaluation:** [frontend/src/authority/Notifications.tsx](frontend/src/authority/Notifications.tsx#L1), [frontend/src/authority/PerformanceEvaluation.tsx](frontend/src/authority/PerformanceEvaluation.tsx#L1)
- **Road admin profile:** [frontend/src/authority/RoadProfileAdmin.tsx](frontend/src/authority/RoadProfileAdmin.tsx#L1)
- **Auth / guard:** [frontend/src/authority/Login.tsx](frontend/src/authority/Login.tsx#L1), [frontend/src/authority/AuthorityGuard.tsx](frontend/src/authority/AuthorityGuard.tsx#L1)

Notes
- Authority workflows center on assignment, verification, escalation, and reporting. The authority dashboard aggregates SLA, fraud risk, and queue health for the jurisdiction.

Authority hierarchy and scope
- Municipal: local ward or municipality operations with the narrowest view of complaints and field staff.
- City/town/village: multi-ward oversight with visibility into nearby municipal teams and contractor activity.
- District: cross-city or district-wide coordination, escalation control, and progress benchmarking.
- State: aggregate oversight, policy review, and comparative analytics across all districts and lower tiers.

Visibility requirements for higher-level authority users
- Each authority user should be able to see all juniors below them in the hierarchy.
- Each junior record should expose contact and profile fields such as `name`, `role`, `gmail`, `phone`, `level`, `jurisdiction`, and `work history`.
- Each contractor record should expose `companyName`, `contactName`, `gmail`, `phone`, `specialization`, `work history`, certification status, and currently assigned projects.
- Each project or assignment should expose `projectId`, `complaintIds`, `assignedTo`, `jurisdiction`, `status`, `slaTarget`, `progressPct`, `lastUpdated`, and `recent complaints` tied to that project.

Suggested shared data structures
- AuthorityPerson: {id:string, name:string, role:string, gmail:string, phone:string, level:'municipal'|'city-town-village'|'district'|'state', jurisdiction:string, status:string}
- AuthorityWorkHistoryItem: {id:string, title:string, jurisdiction:string, startDate:string, endDate?:string, outcome?:string, notes?:string}
- ContractorPerson: {id:string, companyName:string, contactName:string, gmail:string, phone:string, certificationStatus:'Certified'|'Pending renewal'|'Suspended', regions:string[], specialization:string, workHistory:AuthorityWorkHistoryItem[]}
- AuthorityProject: {id:string, projectId:string, name:string, jurisdiction:string, assignedTo:string, complaintIds:string[], status:'Assigned'|'In Progress'|'Pending Approval'|'Resolved'|'Escalated', slaTarget:number, progressPct:number, lastUpdated:string}
- AuthorityHierarchyNode: {level:'municipal'|'city-town-village'|'district'|'state', label:string, totalOpenCases:number, slaBreaches:number, trustScore:number, children:AuthorityHierarchyNode[]}

Per-page components and data structures

- Authority Dashboard -> [frontend/src/pages/dashboard/AuthorityDashboard.tsx](frontend/src/pages/dashboard/AuthorityDashboard.tsx#L1)
	- components:
		- Header: {title:string, jurisdiction?:string}
		- QueueSummary: {open:number, escalations:number, slaBreaches:number}
		- FraudRiskPanel: {clusters:{id:string,riskScore:number,evidenceCount:number}[]}
		- JurisdictionMap: {nodes:JurisdictionNode[]}
		- HierarchySwitch: {level:'municipal'|'city-town-village'|'district'|'state', onChange}
		- JurisdictionProgressPanel: {node:AuthorityHierarchyNode, childNodes:AuthorityHierarchyNode[]}
		- JuniorDirectory: {items:AuthorityPerson[]}
		- ContractorDirectory: {items:ContractorPerson[]}
		- ProjectPortfolio: {items:AuthorityProject[]}
	- data used: `JurisdictionNode[]`, `Insight[]`
	- layout: top header and hierarchy switch, KPI row beneath, then split view with progress analytics on the left and directory/project drilldowns on the right

- Complaint Detail (Authority) -> [frontend/src/authority/ComplaintDetail.tsx](frontend/src/authority/ComplaintDetail.tsx#L1)
	- components:
		- EvidenceGallery: {media:FileMeta[]}
		- VerificationControls: {verify:fn, reject:fn, comments?:string}
		- AssignControl: {authorities:AuthorityProfile[], onAssign(authorityId)}
		- AuditLog: {events:TimelineEvent[]}
		- RelatedProjectPanel: {project:AuthorityProject, recentComplaints:ComplaintRecord[]}
		- PersonContactCard: {person:AuthorityPerson | ContractorPerson}
	- layout: complaint summary at top, evidence and audit in the center, assignment/contact/project cards in a right rail

- Assign Inspector -> [frontend/src/authority/AssignInspector.tsx](frontend/src/authority/AssignInspector.tsx#L1)
	- components:
		- InspectorList: {items:AuthorityProfile[]}
		- AssignmentForm: {selectedInspectorId:string, dueDate?:string, notes?:string}
		- InspectorProfileDrawer: {person:AuthorityPerson, workHistory:AuthorityWorkHistoryItem[]}
	- behavior: higher-level authority should be able to inspect an inspector's contact info, role history, and workload before assignment

- Proof Verification & Repair Wizard -> [frontend/src/pages/ProofVerification.tsx](frontend/src/pages/ProofVerification.tsx#L1), [frontend/src/authority/RepairProofWizard.tsx](frontend/src/authority/RepairProofWizard.tsx#L1)
	- components:
		- ProofReviewPanel: {proof:ProofRecord, decisionOptions:['Accept','Request changes','Reject'], comments?:string}
		- RepairTasks: {tasks:{id:string,description:string,assignedTo?:string}[]}

- Analytics & Reports -> [frontend/src/authority/Analytics.tsx](frontend/src/authority/Analytics.tsx#L1), [frontend/src/authority/DistrictReport.tsx](frontend/src/authority/DistrictReport.tsx#L1)
	- components:
		- ChartCard: {title:string, series:any}
		- ReportExporter: {onExport(format:'csv'|'pdf')}
		- JurisdictionComparisonTable: {rows:{label:string,current:number,previous:number,trend:string}[]}
		- EscalationHeatmap: {nodes:JurisdictionNode[]}

Notes: Authority pages are audit-sensitive; ensure actions are logged in `AuditLog` entries. Reuse `ProofRecord`, `TimelineEvent`, and `AuthorityProfile` shapes from `data/roadwatchDashboard`, and extend them with the hierarchy/person/project shapes above where drill-down is needed.
