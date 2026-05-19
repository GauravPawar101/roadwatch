# Super Admin — Frontend

Overview
- Role: `super-admin` — state-wide oversight with benchmarking, audits, and policy review.
- Super-admin users should see the full hierarchy across municipal, city/town/village, district, and state levels, with drill-down into people, contractors, and projects.

Pages (frontend files)
- **Dashboard / Oversight console:** [frontend/src/pages/dashboard/SuperAdminDashboard.tsx](frontend/src/pages/dashboard/SuperAdminDashboard.tsx#L1)
- **Command Center (role-agnostic entry):** [frontend/src/pages/CommandCenter.tsx](frontend/src/pages/CommandCenter.tsx#L1)
- **Sync & system status:** [frontend/src/pages/SyncStatus.tsx](frontend/src/pages/SyncStatus.tsx#L1)
- **Settings & system configuration:** [frontend/src/pages/Settings.tsx](frontend/src/pages/Settings.tsx#L1)
- **Audit & reporting pages:** (use Authority dashboard reports and `DistrictReport` as reference) [frontend/src/authority/DistrictReport.tsx](frontend/src/authority/DistrictReport.tsx#L1)

Notes
- Super-admins use state-level dashboards to compare districts, audit trust signals, and inspect policy hotspots. Their workflows reuse authority analytics and district reporting components.

Super-admin hierarchy and visibility
- State level: compares all districts, audits trust, and reviews policy exceptions.
- District level: compares jurisdictions and inspects local authority performance.
- City/town/village level: drills into local operations, contractor load, and complaint backlogs.
- Municipal level: surfaces frontline staff performance and unresolved local issues.
- Each higher-level view should expose all subordinate authority users, contractors, projects, and their work history.
- People directory entries should include `name`, `role`, `gmail`, `phone`, `level`, `jurisdiction`, and `work history`.
- Project directory entries should include `projectId`, `assignedTo`, `jurisdiction`, `status`, `progressPct`, `slaTarget`, `recent complaints`, and `audit trail`.

Suggested shared data structures
- SuperAdminHierarchyNode: {level:'municipal'|'city-town-village'|'district'|'state', label:string, openCases:number, slaBreaches:number, trustScore:number, childCount:number, children:SuperAdminHierarchyNode[]}
- DirectoryPerson: {id:string, name:string, role:string, gmail:string, phone:string, level:string, jurisdiction:string, workHistory:{id:string,title:string,status:string,startDate:string,endDate?:string}[]}
- DirectoryContractor: {id:string, companyName:string, contactName:string, gmail:string, phone:string, jurisdictions:string[], certifications:string[], workHistory:{id:string,title:string,status:string,startDate:string,endDate?:string}[]}
- OversightProject: {id:string, projectId:string, name:string, jurisdiction:string, assignedTo:string, status:'Assigned'|'In Progress'|'Pending Approval'|'Resolved'|'Escalated', progressPct:number, slaTarget:number, complaintIds:string[], auditTrail:string[]}

Per-page components and data structures

- Super Admin Dashboard -> [frontend/src/pages/dashboard/SuperAdminDashboard.tsx](frontend/src/pages/dashboard/SuperAdminDashboard.tsx#L1)
	- components:
		- GlobalHeader: {title:string, lastSync?:string}
		- BenchmarkTable: {rows:{district:string,trust:number,openCases:number,trend?:string}[]}
		- SpotlightCards: {items:Insight[]}
		- ComparativeCharts: {series:any}
		- HierarchyOverview: {root:SuperAdminHierarchyNode}
		- AuthorityDirectory: {items:DirectoryPerson[]}
		- ContractorDirectory: {items:DirectoryContractor[]}
		- OversightPortfolio: {items:OversightProject[]}
	- layout: summary KPIs and hierarchy controls at top, drill-down analytics in the main body, and cross-linked people/project panels on the side

- Command Center -> [frontend/src/pages/CommandCenter.tsx](frontend/src/pages/CommandCenter.tsx#L1)
	- components:
		- RoleSwitch: {current:DashboardRole, onSwitch(role)}
		- SystemAssistant: {messages:{from:string,text:string}[]}
		- ScopeFilter: {level:string, jurisdiction:string, projectId?:string}
	- behavior: the command center should make it easy to move between hierarchy layers and inspect the scope currently selected

- Sync Status -> [frontend/src/pages/SyncStatus.tsx](frontend/src/pages/SyncStatus.tsx#L1)
	- components:
		- SyncLog: {entries:{time:string,service:string,status:'ok'|'warn'|'fail',details?:string}[]}
		- TriggerSyncButton: {onClick}
		- RegionStatusCard: {label:string, updatedAt:string, health:'healthy'|'warning'|'critical'}

- Settings & Reports -> [frontend/src/pages/Settings.tsx](frontend/src/pages/Settings.tsx#L1)
	- components:
		- SystemConfigForm: {values:Record<string,any>}
		- ExportPolicyReport: {onExport}
		- AuditTrailViewer: {items:{id:string,actor:string,action:string,time:string}[]}
	- behavior: this page should let super-admins review policy, export reports, and inspect audit trails across all lower-level jurisdictions

Notes: Super-admin views are aggregation-heavy and should reuse authority analytics components. Data tables should include IDs and cross-links to authority dashboards for drill-down.
