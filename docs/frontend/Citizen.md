# Citizen — Frontend

Overview
- Role: `citizen` — interacts with the public-facing dashboard to submit and track civic complaints.
- Citizen visibility should be limited to people assigned to the citizen's own work or complaint chain.

Pages (frontend files)
- **Dashboard:** [frontend/src/pages/dashboard/CitizenDashboard.tsx](frontend/src/pages/dashboard/CitizenDashboard.tsx#L1)
- **Submit complaint / wizard:** [frontend/src/pages/ComplaintWizard.tsx](frontend/src/pages/ComplaintWizard.tsx#L1)
- **Complaint creation alias:** `/complaints/new` now routes to the same wizard as `/road/:id/report`.
- **My complaints (list):** [frontend/src/pages/MyComplaints.tsx](frontend/src/pages/MyComplaints.tsx#L1)
- **Complaint detail / tracking:** [frontend/src/pages/ComplaintDetail.tsx](frontend/src/pages/ComplaintDetail.tsx#L1)
- **Media upload (evidence):** [frontend/src/pages/MediaUpload.tsx](frontend/src/pages/MediaUpload.tsx#L1)
- **Map view:** [frontend/src/pages/MapView.tsx](frontend/src/pages/MapView.tsx#L1)
- **Road profile & history:** [frontend/src/pages/RoadProfile.tsx](frontend/src/pages/RoadProfile.tsx#L1), [frontend/src/pages/RoadHistory.tsx](frontend/src/pages/RoadHistory.tsx#L1)
- **Onboarding / settings:** [frontend/src/pages/Onboarding.tsx](frontend/src/pages/Onboarding.tsx#L1), [frontend/src/pages/Settings.tsx](frontend/src/pages/Settings.tsx#L1)
- **Profile hub alias:** [frontend/src/pages/Settings.tsx](frontend/src/pages/Settings.tsx#L1) is also reachable at `/profile`.

Notes
- Citizen flows prioritize submission, evidence upload, and tracking. Use the `CitizenDashboard` as the entry point.
- The complaint wizard now starts with photo upload and keeps the upload running while details are entered.
- The map page is expected to use aggregated heatmap mode for broader regional views.

Citizen visibility constraint
- Citizens should only see people explicitly assigned to their own work, complaint, or follow-up flow.
- For those assigned people, only `gmail` and `office mobile no` should be shown.
- Do not expose private phone numbers, home addresses, personal notes, or unrelated authority/contractor records.
- If a person is not linked to the citizen's complaint, project, or verification chain, they should not appear in the citizen UI.

Suggested shared data structures
- AssignedPersonContact: {id:string, name:string, gmail:string, officeMobileNo:string, role:string, assignmentId:string, complaintIds:string[], projectIds:string[]}
- CitizenAssignedPeopleGroup: {workId:string, title:string, people:AssignedPersonContact[]}

Per-page components and data structures

- Citizen Dashboard -> [frontend/src/pages/dashboard/CitizenDashboard.tsx](frontend/src/pages/dashboard/CitizenDashboard.tsx#L1)
	- components:
		- Header: {title: string, subtitle?: string, roleBadge?: string}
		- InsightPanel: {items: Insight[]} (uses `Insight` from `data/roadwatchDashboard`)
		- ComplaintList: {items: ComplaintRecord[], onSelect: (id: string) => void}
		- QuickActions: {actions: string[]} (uses `roleActionLabels.citizen`)
	- layout/positions: Header (top), QuickActions (left or top), InsightPanel (right), ComplaintList (center)

- Complaint Wizard -> [frontend/src/pages/ComplaintWizard.tsx](frontend/src/pages/ComplaintWizard.tsx#L1)
	- components:
		- Stepper: {steps: {id:string,label:string}[], current: number}
		- LocationPicker: {value: {lat:number,lng:number}|null, onChange}
		- MediaUploader: {files: FileMeta[], onAdd, onRemove}
		- DetailsForm: {title:string, category:string, description:string}
	- data structures:
		- FileMeta: {id:string, name:string, size:number, mime:string, url?:string, uploadedAt?:string}
		- ComplaintDraft: {title:string, category:string, description:string, location:{lat:number,lng:number,address?:string}, media:FileMeta[]}
	- layout: Stepper (top), LocationPicker + DetailsForm (main), MediaUploader (side or below)

- My Complaints -> [frontend/src/pages/MyComplaints.tsx](frontend/src/pages/MyComplaints.tsx#L1)
	- components:
		- FilterBar: {status?: ComplaintStatus, category?:string, query?:string}
		- ComplaintCard: {complaint: ComplaintRecord}
		- Pagination: {page:number, total:number}
	- data flow: fetch list -> map to `ComplaintCard` -> actions: view, escalate, verify

- Complaint Detail -> [frontend/src/pages/ComplaintDetail.tsx](frontend/src/pages/ComplaintDetail.tsx#L1)
	- components:
		- EvidenceGallery: {media: FileMeta[]}
		- Timeline: {events: TimelineEvent[]}
		- ActionPanel: {availableActions: string[], onAction}
		- LocationMap: {geo: string} (string 'lat,lng' or object)
		- AssignedPeoplePanel: {groups: CitizenAssignedPeopleGroup[]}
	- data used: `ComplaintRecord`, `TimelineEvent[]`, `FileMeta[]`
	- visibility: only show assigned people tied to the complaint or related work, and only their `gmail` and `officeMobileNo`

- Media Upload -> [frontend/src/pages/MediaUpload.tsx](frontend/src/pages/MediaUpload.tsx#L1)
	- components:
		- ResumableUpload: {onComplete(fileMeta: FileMeta)} (see `components/ResumableUpload.tsx`)
		- PreviewList: {files: FileMeta[]}
	- data structure: reuse `FileMeta`

- Map View -> [frontend/src/pages/MapView.tsx](frontend/src/pages/MapView.tsx#L1)
	- components:
		- MapContainer: {center:{lat:number,lng:number}, zoom:number}
		- ComplaintPin: {id:string, position:{lat:number,lng:number}, severity:number, status:ComplaintStatus}
		- Legend: {items:{label:string,color:string}[]}
		- AssignedPeopleSidebar: {people:AssignedPersonContact[]}
	- visibility: the sidebar should only include people already linked to the citizen's work scope, with contact limited to `gmail` and `officeMobileNo`

General notes: prefer reuse of `ComplaintRecord`, `TimelineEvent`, `Insight`, `FileMeta`, and `AssignedPersonContact` shapes across citizen components. Keep props minimal and serializable for storage in local drafts.
