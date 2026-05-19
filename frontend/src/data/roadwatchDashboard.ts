export type DashboardRole = 'citizen' | 'contractor' | 'authority' | 'super-admin'

export type AuthorityLevel = 'junior-engineer' | 'district-officer' | 'chief-engineer'

export type ComplaintStatus = 'Reported' | 'Verified' | 'Assigned' | 'In Progress' | 'Pending Approval' | 'Resolved' | 'Escalated' | 'Rejected'

export type ComplaintRecord = {
  id: string
  complaintId: string
  roadId: string
  title: string
  category: string
  district: string
  state: string
  geo: string
  severity: number
  status: ComplaintStatus
  slaHoursLeft: number
  trustImpact: number
  karmaImpact: number
  blockchainRef: string
  assignedAuthority: string
  assignedContractor: string
  updatedAt: string
  createdAt: string
  evidenceCount: number
  fraudRisk: number
  duplicateCluster: string | null
}

export type CitizenProfile = {
  name: string
  handle: string
  trustScore: number
  credibilityIndex: number
  totalSubmitted: number
  resolved: number
  pending: number
  escalated: number
  rewardPoints: number
}

export type ContractorProfile = {
  name: string
  handle: string
  trustScore: number
  performanceScore: number
  slaScore: number
  authorityRating: number
  citizenValidation: number
  regions: string[]
  certificationStatus: 'Certified' | 'Pending renewal'
}

export type AuthorityProfile = {
  name: string
  role: string
  scope: string
  level: AuthorityLevel
  district?: string
  state?: string
  efficiencyScore: number
}

export type Insight = {
  title: string
  detail: string
  tone: 'good' | 'warning' | 'danger' | 'neutral'
}

export type TimelineEvent = {
  id: string
  time: string
  title: string
  description: string
  kind: 'assignment' | 'approval' | 'verification' | 'escalation' | 'audit'
}

export type JurisdictionNode = {
  name: string
  risk: number
  openCases: number
  slaBreaches: number
  contractorHealth: number
  trust: number
}

export const complaints: ComplaintRecord[] = [
  { id: 'cmp-1001', complaintId: 'RW-DEL-1024', roadId: 'ND-14A', title: 'Deep pothole at school junction', category: 'Pothole', district: 'South Delhi', state: 'Delhi', geo: '28.524, 77.206', severity: 9, status: 'Escalated', slaHoursLeft: -8, trustImpact: -14, karmaImpact: -8, blockchainRef: 'FAB-8E2C-11AF', assignedAuthority: 'Executive Engineer, South Delhi', assignedContractor: 'SuperBuild Infra', updatedAt: '12 min ago', createdAt: '2026-05-13T08:21:00Z', evidenceCount: 6, fraudRisk: 12, duplicateCluster: 'Cluster-A' },
  { id: 'cmp-1002', complaintId: 'RW-MUM-2011', roadId: 'MH-48B', title: 'Broken divider near service lane', category: 'Divider damage', district: 'Mumbai', state: 'Maharashtra', geo: '19.075, 72.877', severity: 7, status: 'Assigned', slaHoursLeft: 18, trustImpact: 5, karmaImpact: 3, blockchainRef: 'FAB-91FD-44D2', assignedAuthority: 'District Officer, Mumbai', assignedContractor: 'RoadForge Works', updatedAt: '38 min ago', createdAt: '2026-05-12T10:00:00Z', evidenceCount: 4, fraudRisk: 19, duplicateCluster: null },
  { id: 'cmp-1003', complaintId: 'RW-LKO-3007', roadId: 'UP-27C', title: 'Drain blockage after rainfall', category: 'Drainage', district: 'Lucknow', state: 'Uttar Pradesh', geo: '26.846, 80.946', severity: 8, status: 'In Progress', slaHoursLeft: 32, trustImpact: 8, karmaImpact: 5, blockchainRef: 'FAB-9C12-107A', assignedAuthority: 'Junior Engineer, Lucknow East', assignedContractor: 'Apex Civil', updatedAt: '1h ago', createdAt: '2026-05-12T15:24:00Z', evidenceCount: 3, fraudRisk: 9, duplicateCluster: 'Cluster-C' },
  { id: 'cmp-1004', complaintId: 'RW-PUN-4019', roadId: 'MH-11D', title: 'Unsafe shoulder erosion', category: 'Shoulder erosion', district: 'Pune', state: 'Maharashtra', geo: '18.520, 73.856', severity: 6, status: 'Pending Approval', slaHoursLeft: 9, trustImpact: 4, karmaImpact: 2, blockchainRef: 'FAB-A412-77EF', assignedAuthority: 'District Officer, Pune', assignedContractor: 'Westline Infra', updatedAt: '2h ago', createdAt: '2026-05-11T13:40:00Z', evidenceCount: 5, fraudRisk: 28, duplicateCluster: null },
  { id: 'cmp-1005', complaintId: 'RW-BLR-5090', roadId: 'KA-19E', title: 'Missing warning signage', category: 'Signage', district: 'Bengaluru Urban', state: 'Karnataka', geo: '12.971, 77.594', severity: 5, status: 'Resolved', slaHoursLeft: 72, trustImpact: 10, karmaImpact: 7, blockchainRef: 'FAB-FEE1-1203', assignedAuthority: 'Chief Engineer, Karnataka', assignedContractor: 'CityPeak Projects', updatedAt: '6h ago', createdAt: '2026-05-09T07:10:00Z', evidenceCount: 4, fraudRisk: 6, duplicateCluster: null },
  { id: 'cmp-1006', complaintId: 'RW-CHE-6214', roadId: 'TN-08F', title: 'Crack propagation in arterial road', category: 'Crack', district: 'Chennai', state: 'Tamil Nadu', geo: '13.082, 80.270', severity: 8, status: 'Verified', slaHoursLeft: 26, trustImpact: 7, karmaImpact: 4, blockchainRef: 'FAB-1D9A-6C01', assignedAuthority: 'Section Officer, Chennai East', assignedContractor: 'MetroRoads Ltd', updatedAt: '5h ago', createdAt: '2026-05-10T11:52:00Z', evidenceCount: 5, fraudRisk: 14, duplicateCluster: 'Cluster-B' },
]

for (let index = 7; index <= 18; index += 1) {
  complaints.push({
    id: `cmp-${1000 + index}`,
    complaintId: `RW-DEL-${2000 + index}`,
    roadId: `DL-${index.toString().padStart(2, '0')}X`,
    title: index % 2 === 0 ? 'Road edge sinkhole' : 'Joint failure near bus stop',
    category: index % 2 === 0 ? 'Sinkhole' : 'Joint failure',
    district: index % 3 === 0 ? 'South Delhi' : 'New Delhi',
    state: 'Delhi',
    geo: '28.613, 77.209',
    severity: 7 + (index % 3),
    status: index % 4 === 0 ? 'Escalated' : index % 3 === 0 ? 'In Progress' : 'Assigned',
    slaHoursLeft: 12 - index,
    trustImpact: 2 + index,
    karmaImpact: 1 + (index % 5),
    blockchainRef: `FAB-DEL-${index.toString().padStart(4, '0')}`,
    assignedAuthority: 'District Officer, Delhi',
    assignedContractor: index % 2 === 0 ? 'SuperBuild Infra' : 'MetroRoads Ltd',
    updatedAt: `${index + 1}h ago`,
    createdAt: `2026-05-${(index % 9) + 2}T09:15:00Z`,
    evidenceCount: 2 + (index % 4),
    fraudRisk: 8 + (index % 20),
    duplicateCluster: index % 5 === 0 ? 'Cluster-A' : null,
  })
}

export const citizenProfile: CitizenProfile = {
  name: 'Aarav Mehta',
  handle: 'citizen.01',
  trustScore: 92,
  credibilityIndex: 88,
  totalSubmitted: 18,
  resolved: 11,
  pending: 5,
  escalated: 2,
  rewardPoints: 1460,
}

export const contractorProfiles: ContractorProfile[] = [
  { name: 'SuperBuild Infra', handle: 'superbuild-infra', trustScore: 91, performanceScore: 94, slaScore: 89, authorityRating: 92, citizenValidation: 87, regions: ['South Delhi', 'New Delhi'], certificationStatus: 'Certified' },
  { name: 'RoadForge Works', handle: 'roadforge-works', trustScore: 86, performanceScore: 88, slaScore: 84, authorityRating: 82, citizenValidation: 81, regions: ['Mumbai', 'Pune'], certificationStatus: 'Certified' },
  { name: 'MetroRoads Ltd', handle: 'metroroads-ltd', trustScore: 84, performanceScore: 86, slaScore: 80, authorityRating: 85, citizenValidation: 79, regions: ['Chennai', 'Bengaluru Urban'], certificationStatus: 'Pending renewal' },
]

export const authorityProfiles: AuthorityProfile[] = [
  { name: 'Neha Sharma', role: 'Junior Engineer', scope: 'South Delhi ward cluster', level: 'junior-engineer', district: 'South Delhi', state: 'Delhi', efficiencyScore: 84 },
  { name: 'Rohit Verma', role: 'Executive Engineer', scope: 'District operations - Delhi', level: 'district-officer', district: 'Delhi', state: 'Delhi', efficiencyScore: 90 },
  { name: 'Dr. P. Iyer', role: 'Chief Engineer', scope: 'State strategic oversight', level: 'chief-engineer', state: 'Multi-state', efficiencyScore: 93 },
]

export const jurisdictionMap: JurisdictionNode[] = [
  { name: 'South Delhi', risk: 82, openCases: 27, slaBreaches: 6, contractorHealth: 78, trust: 72 },
  { name: 'Mumbai', risk: 61, openCases: 14, slaBreaches: 3, contractorHealth: 85, trust: 80 },
  { name: 'Pune', risk: 57, openCases: 11, slaBreaches: 2, contractorHealth: 88, trust: 84 },
  { name: 'Lucknow', risk: 68, openCases: 19, slaBreaches: 4, contractorHealth: 81, trust: 79 },
  { name: 'Bengaluru Urban', risk: 52, openCases: 9, slaBreaches: 1, contractorHealth: 90, trust: 88 },
  { name: 'Chennai', risk: 47, openCases: 8, slaBreaches: 1, contractorHealth: 87, trust: 86 },
  { name: 'New Delhi', risk: 73, openCases: 22, slaBreaches: 5, contractorHealth: 83, trust: 77 },
  { name: 'Noida', risk: 58, openCases: 13, slaBreaches: 2, contractorHealth: 84, trust: 82 },
]

export const timelineEvents: TimelineEvent[] = [
  { id: 'evt-1', time: '09:42', title: 'Executive review completed', description: 'South Delhi escalation received district approval.', kind: 'approval' },
  { id: 'evt-2', time: '10:08', title: 'Contractor proof uploaded', description: 'SuperBuild Infra submitted geo-tagged before/after evidence.', kind: 'verification' },
  { id: 'evt-3', time: '10:31', title: 'Fraud flag triggered', description: 'Duplicate complaint cluster detected near school junction.', kind: 'audit' },
  { id: 'evt-4', time: '11:12', title: 'SLA breach escalated', description: 'One high-severity case crossed the critical threshold.', kind: 'escalation' },
]

export const insights: Insight[] = [
  { title: 'High Risk Zones', detail: 'South Delhi and New Delhi hold the highest density of severe complaints and SLA risk.', tone: 'danger' },
  { title: 'Likely Fraud Cases', detail: 'Duplicate complaint clusters with low evidence count should be manually reviewed.', tone: 'warning' },
  { title: 'Top Performing Contractors', detail: 'SuperBuild Infra is outperforming on SLA, citizen validation, and trust stability.', tone: 'good' },
  { title: 'Authority Gaps', detail: 'District review latency spikes when approval queues exceed seven items.', tone: 'neutral' },
]

export const complaintTrends = [
  { name: 'Mon', citizen: 12, contractor: 6, authority: 8 },
  { name: 'Tue', citizen: 18, contractor: 8, authority: 10 },
  { name: 'Wed', citizen: 24, contractor: 11, authority: 14 },
  { name: 'Thu', citizen: 19, contractor: 13, authority: 11 },
  { name: 'Fri', citizen: 26, contractor: 15, authority: 17 },
  { name: 'Sat', citizen: 21, contractor: 14, authority: 12 },
  { name: 'Sun', citizen: 16, contractor: 9, authority: 9 },
]

export const roleActionLabels: Record<DashboardRole, string[]> = {
  citizen: ['Submit complaint', 'Track complaint', 'Verify completion', 'Request escalation'],
  contractor: ['Upload proof', 'Update progress', 'Request extension', 'Submit completion'],
  authority: ['Assign contractor', 'Escalate case', 'Override SLA', 'Generate report'],
  'super-admin': ['Benchmark state', 'Audit trust', 'Inspect fraud', 'Review policies'],
}

export const roleScopeLabels: Record<DashboardRole, string> = {
  citizen: 'Personal civic profile',
  contractor: 'Regional delivery workspace',
  authority: 'Jurisdictional control tower',
  'super-admin': 'State-wide oversight grid',
}
