import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    ChevronRight,
    Clock,
    FolderOpen,
    Globe2,
    LayoutDashboard,
    Network,
    Phone,
    ShieldCheck,
    Sparkles,
    UserCheck,
    Users,
    Wrench
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from 'recharts'
import MapEmbed from '../../components/MapEmbed'
import { Badge, Button, Card, CardBody, Container } from '../../components/UIComponents'
import { contractorProfiles, getContractorComplaintRows } from '../../data/roadwatchDashboard'

type ContractorScorecardRow = {
  contractorId: string
  contractorName: string
  karmaScore: number
  reliabilityRank: number
  avgSlaSuccessDays: number | null
  repeatFailureRate: number
  budgetDisciplineScore: number
  citizenSatisfactionScore: number
  auditPerformanceScore: number
  maintenanceEfficiencyScore: number
  historicalDurabilityDays: number
  regionalExpertise: string[]
  roadTypeSpecialization: string[]
  riskIndicator: 'low' | 'medium' | 'high'
  lifecycleCostINR: number
  proposalConfidence: number
  assignedCount: number
  resolvedCount: number
  openCount: number
  avgResolutionDays: number | null
  slaBreaches: number
  onTimeRate: number | null
}

function normalizeText(value: string | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

// Mock activity log for completion rates
const velocityData = [
  { day: 'Mon', completed: 62, target: 80 },
  { day: 'Tue', completed: 78, target: 80 },
  { day: 'Wed', completed: 85, target: 80 },
  { day: 'Thu', completed: 72, target: 80 },
  { day: 'Fri', completed: 90, target: 80 }
]

const seedProjects = [
  { id: 'p1', roadName: 'NH-48 Section 3', type: 'NH', start: '2024-04-01', end: '2027-03-31', phase: 'Under Construction', complaints: 4, condition: 71, authority: 'Dr. Elena Rodriguez', completionPercent: 65 },
  { id: 'p2', roadName: 'SH-27 Bypass', type: 'SH', start: '2023-07-01', end: '2026-06-30', phase: 'Maintenance', complaints: 1, condition: 84, authority: 'District Engineer', completionPercent: 88 },
  { id: 'p3', roadName: 'MDR-11 Link Road', type: 'MDR', start: '2022-12-15', end: '2025-12-14', phase: 'DLP', complaints: 2, condition: 63, authority: 'Rural Works Office', completionPercent: 100 },
]

const projectCoordinates: Record<string, { lat: number; lng: number }> = {
  p1: { lat: 28.6139, lng: 77.209 },
  p2: { lat: 19.076, lng: 72.8777 },
  p3: { lat: 18.5204, lng: 73.8567 },
}

export default function ContractorDashboard() {
  const navigate = useNavigate()
  const contractorHandle = localStorage.getItem('roadwatch_contractor_id') || contractorProfiles[0]?.handle || 'superbuild-infra'
  const contractorProfile = contractorProfiles.find((profile) => profile.handle === contractorHandle || profile.name === contractorHandle) ?? contractorProfiles[0]
  const apiBase = ((import.meta as any).env?.VITE_API_BASE as string | undefined) || 'http://localhost:3100'
  const [projects] = useState(seedProjects)
  const assignedComplaints = useMemo(() => getContractorComplaintRows(contractorProfile.name), [contractorProfile.name])
  const projectChartData = useMemo(() => projects.map((project) => ({ name: project.type, completion: project.completionPercent, complaints: project.complaints })), [projects])
  const mapMarkers = projects.map((project) => ({ ...projectCoordinates[project.id], label: `${project.roadName} · ${project.completionPercent}% complete` }))
  const openCases = assignedComplaints.filter((item) => item.status !== 'Resolved')
  const criticalCases = assignedComplaints.filter((item) => item.severity >= 8)
  const breachCases = assignedComplaints.filter((item) => item.slaHoursLeft <= 12)
  const scorecardQuery = useQuery({
    queryKey: ['public-contractor-scorecard', contractorProfile.handle],
    queryFn: async () => {
      const response = await fetch(`${apiBase}/public/contractors/scorecard?limit=20`)
      if (!response.ok) {
        throw new Error(`Failed to load contractor scorecard: ${response.status}`)
      }
      return (await response.json()) as { rows: ContractorScorecardRow[] }
    }
  })
  const leaderboard = useMemo(
    () => (scorecardQuery.data?.rows ?? []).slice().sort((left, right) => right.karmaScore - left.karmaScore),
    [scorecardQuery.data]
  )
  const liveContractorRow = leaderboard.find(
    (row) => normalizeText(row.contractorName) === normalizeText(contractorProfile.name) || normalizeText(row.contractorId) === normalizeText(contractorProfile.handle)
  )
  const liveKarma = liveContractorRow?.karmaScore ?? contractorProfile.karmaScore
  const liveRank = liveContractorRow?.reliabilityRank ?? contractorProfile.reliabilityRank
  const karmaTrendData = contractorProfile.karmaTrend.map((value, index) => ({ day: `W${index + 1}`, karma: value }))

  return (
    <div className="page-radial-bg min-h-screen text-on-surface py-12">
    <Container>
      <div className="space-y-6 pb-12">
        {/* Header Block */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-outline-variant pb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full bg-secondary animate-pulse" />
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-secondary">
                Northwest Sector • Active Hub
              </p>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-on-surface">
              Regional Maintenance Hub
            </h1>
            <p className="text-on-surface-variant text-sm mt-1">
              Welcome back, <span className="text-on-surface font-semibold">{contractorProfile.name}</span>. Lead Contractor Space for {contractorProfile.regions.join(', ')}.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => navigate('/contractor/vault')}
              className="glass-panel flex items-center gap-2 border-outline-variant text-on-surface hover:bg-surface-container-low"
            >
              <FolderOpen className="h-4 w-4 text-secondary" />
              Document Vault
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate('/contractor/complaints')}
              className="glass-panel flex items-center gap-2 border-outline-variant text-on-surface hover:bg-surface-container-low"
            >
              <Wrench className="h-4 w-4 text-secondary" />
              Work Queue
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate('/map')}
              className="glass-panel flex items-center gap-2 border-outline-variant text-on-surface hover:bg-surface-container-low"
            >
              <FolderOpen className="h-4 w-4 text-secondary" />
              Regional Map
            </Button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div whileHover={{ y: -4 }} className="transition-all duration-300">
            <Card className="glass-panel border-error/20 bg-error-container/10">
              <CardBody className="p-5">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-error">SLA Breaches</p>
                    <h3 className="text-3xl font-black text-on-surface mt-1">{breachCases.length}</h3>
                  </div>
                  <div className="p-2.5 bg-error-container rounded-xl border border-error/20">
                    <AlertTriangle className="h-5 w-5 text-error" />
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant mt-3 font-medium">⚠️ {criticalCases.length} critical complaints need attention</p>
              </CardBody>
            </Card>
          </motion.div>

          <motion.div whileHover={{ y: -4 }} className="transition-all duration-300">
            <Card className="glass-panel border-secondary/20 bg-secondary-container/10">
              <CardBody className="p-5">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-secondary">Open Cases</p>
                    <h3 className="text-3xl font-black text-on-surface mt-1">{openCases.length}</h3>
                  </div>
                  <div className="p-2.5 bg-secondary-container rounded-xl border border-secondary/20">
                    <Wrench className="h-5 w-5 text-secondary" />
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant mt-3 font-medium">⚡ Assigned complaints routed to this contractor</p>
              </CardBody>
            </Card>
          </motion.div>

          <motion.div whileHover={{ y: -4 }} className="transition-all duration-300">
            <Card className="glass-panel border-secondary/20 bg-secondary-container/10">
              <CardBody className="p-5">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-secondary">Regional Coverage</p>
                    <h3 className="text-3xl font-black text-on-surface mt-1">{Math.round((contractorProfile.regions.length / Math.max(1, contractorProfiles.length)) * 100)}%</h3>
                  </div>
                  <div className="p-2.5 bg-secondary-container rounded-xl border border-secondary/20">
                    <Activity className="h-5 w-5 text-secondary" />
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant mt-3 font-medium">✓ Regions: {contractorProfile.regions.join(', ')}</p>
              </CardBody>
            </Card>
          </motion.div>

          <motion.div whileHover={{ y: -4 }} className="transition-all duration-300">
            <Card className="glass-panel border-tertiary/20 bg-tertiary-container/10" style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', top: 14, right: 14, padding: '6px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(148,163,184,0.45)', fontSize: 11, fontWeight: 800, color: '#0f172a' }}>
                Karma #{liveRank}
              </div>
              <CardBody className="p-5">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-tertiary">Live karma score</p>
                    <h3 className="text-3xl font-black text-on-surface mt-1">{liveKarma}</h3>
                  </div>
                  <div className="p-2.5 bg-tertiary-container rounded-xl border border-tertiary/20">
                    <ShieldCheck className="h-5 w-5 text-tertiary" />
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant mt-3 font-medium">Durability {liveContractorRow?.historicalDurabilityDays ?? contractorProfile.historicalDurabilityDays}d · budget discipline {liveContractorRow?.budgetDisciplineScore ?? contractorProfile.budgetDisciplineScore} · risk {liveContractorRow?.riskIndicator ?? contractorProfile.riskIndicator}</p>
              </CardBody>
            </Card>
          </motion.div>
        </div>

        {/* Dashboard Panels Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left / Middle: Projects & Velocity Chart */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="glass-panel border-outline-variant bg-surface-container-lowest">
              <CardBody className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                      <Wrench className="h-5 w-5 text-secondary" />
                      Assigned Complaints
                    </h3>
                    <p className="text-on-surface-variant text-xs mt-1">
                      Complaints routed to {contractorProfile.name} across {contractorProfile.regions.join(', ')}.
                    </p>
                  </div>
                  <Badge variant="warning" className="px-3 py-1 font-semibold uppercase tracking-wider text-[10px]">
                    {assignedComplaints.length} Routed
                  </Badge>
                </div>

                <div className="space-y-3 max-h-[380px] overflow-auto pr-1">
                  {assignedComplaints.slice(0, 6).map((complaint) => (
                    <motion.div
                      key={complaint.id}
                      whileHover={{ scale: 1.01 }}
                      className="rounded-xl border border-outline-variant bg-surface-container-low p-4 transition-all duration-300 hover:border-secondary/30 hover:bg-surface-container-lowest"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold uppercase tracking-wider text-secondary px-2 py-0.5 rounded bg-secondary-container border border-secondary/20">
                              {complaint.category}
                            </span>
                            <h4 className="text-base font-bold text-on-surface">{complaint.title}</h4>
                          </div>
                          <p className="text-xs text-on-surface-variant mt-1">
                            {complaint.complaintId} · {complaint.district} · SLA {complaint.slaHoursLeft}h left
                          </p>
                        </div>
                        <Button
                          variant="primary"
                          onClick={() => navigate(`/contractor/complaint/${complaint.id}`)}
                          className="text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1 bg-secondary text-white hover:bg-primary"
                        >
                          Open Case
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* Assigned Projects Card */}
            <Card className="glass-panel border-outline-variant bg-surface-container-lowest">
              <CardBody className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                      <Wrench className="h-5 w-5 text-secondary" />
                      Assigned Infrastructure Projects
                    </h3>
                    <p className="text-on-surface-variant text-xs mt-1">
                      Manage progress, upload cryptographically signed proofs, and monitor active complaints.
                    </p>
                  </div>
                  <Badge variant="success" className="px-3 py-1 font-semibold uppercase tracking-wider text-[10px]">
                    {projects.length} Assigned
                  </Badge>
                </div>

                <div className="space-y-4">
                  {projects.map((p) => (
                    <motion.div
                      key={p.id}
                      whileHover={{ scale: 1.01 }}
                      className="group relative overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low p-4 transition-all duration-300 hover:border-secondary/30 hover:bg-surface-container-lowest"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold uppercase tracking-wider text-secondary px-2 py-0.5 rounded bg-secondary-container border border-secondary/20">
                              {p.type}
                            </span>
                            <h4 className="text-base font-bold text-on-surface group-hover:text-secondary transition-colors">
                              {p.roadName}
                            </h4>
                          </div>
                          <p className="text-xs text-on-surface-variant">
                            Timeline: <span className="text-on-surface">{p.start}</span> to <span className="text-on-surface">{p.end}</span>
                          </p>
                          <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-on-surface-variant">
                            <span className="flex items-center gap-1">
                              <Activity className="h-3.5 w-3.5 text-secondary" />
                              Phase: <strong className="text-on-surface">{p.phase}</strong>
                            </span>
                            <span className="flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5 text-error" />
                              Active Complaints: <strong className="text-error">{p.complaints}</strong>
                            </span>
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="h-3.5 w-3.5 text-tertiary" />
                              Health: <strong className="text-tertiary">{p.condition}/100</strong>
                            </span>
                          </div>
                          {/* Progress bar */}
                          <div className="w-full bg-surface-container-low h-1.5 rounded-full overflow-hidden mt-3 max-w-md">
                            <div
                              className="bg-gradient-to-r from-secondary to-tertiary h-full"
                              style={{ width: `${p.completionPercent}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex sm:flex-col gap-2 min-w-[120px]">
                          <Button
                            variant="primary"
                            onClick={() => navigate(`/contractor/project/${p.id}`)}
                            className="w-full text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1 bg-secondary text-white hover:bg-primary"
                          >
                            Open Details
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => navigate(`/contractor/proof/${p.id}`)}
                            className="w-full text-xs font-semibold py-2 px-3 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
                          >
                            Upload Proof
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </CardBody>
            </Card>

            <Card className="glass-panel border-outline-variant bg-surface-container-lowest">
              <CardBody className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                      <Globe2 className="h-5 w-5 text-secondary" />
                      Project region map
                    </h3>
                    <p className="text-on-surface-variant text-xs mt-1">
                      Inspect which projects are active across the contractor's current delivery regions.
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => navigate('/profile')} className="glass-panel flex items-center gap-2 border-outline-variant text-on-surface hover:bg-surface-container-low">
                    <LayoutDashboard className="h-4 w-4 text-secondary" />
                    Profile
                  </Button>
                </div>
                <div className="rounded-xl overflow-hidden border border-outline-variant">
                  <MapEmbed center={{ lat: 22.0, lng: 78.5 }} zoom={5} markers={mapMarkers} height="240px" />
                </div>
              </CardBody>
            </Card>

            <Card className="glass-panel border-outline-variant bg-surface-container-lowest">
              <CardBody className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-secondary" />
                      Historical karma trend
                    </h3>
                    <p className="text-on-surface-variant text-xs mt-1">
                      Karma should rise as SLA success, durability, and citizen feedback improve.
                    </p>
                  </div>
                </div>
                <div className="w-full overflow-hidden">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={karmaTrendData}>
                      <CartesianGrid strokeDasharray="4 4" strokeOpacity={0.12} />
                      <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={[60, 100]} />
                      <Tooltip contentStyle={{ background: '#ffffff', borderColor: 'rgba(196,198,207,0.9)', borderRadius: '8px', color: '#1a1b1e' }} />
                      <Bar dataKey="karma" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>

            <Card className="glass-panel border-outline-variant bg-surface-container-lowest">
              <CardBody className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                      <Activity className="h-5 w-5 text-secondary" />
                      Delivery trend chart
                    </h3>
                    <p className="text-on-surface-variant text-xs mt-1">
                      Project completion and complaint density by work package.
                    </p>
                  </div>
                </div>
                <div className="w-full overflow-hidden">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={projectChartData}>
                      <CartesianGrid strokeDasharray="4 4" strokeOpacity={0.12} />
                      <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: '#ffffff', borderColor: 'rgba(196,198,207,0.9)', borderRadius: '8px', color: '#1a1b1e' }} />
                      <Bar dataKey="completion" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="complaints" fill="#7c3aed" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>

            {/* Velocity Area Chart */}
            <Card className="glass-panel border-outline-variant bg-surface-container-lowest">
              <CardBody className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                      <Clock className="h-5 w-5 text-secondary" />
                      Regional Delivery Velocity
                    </h3>
                    <p className="text-on-surface-variant text-xs mt-1">
                      Mon-Fri work order completion rates against target thresholds.
                    </p>
                  </div>
                  <Badge variant="success" className="px-3 py-1 font-semibold text-[10px]">
                    SLA TARGETS MET
                  </Badge>
                </div>

                <div className="w-full overflow-hidden">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={velocityData}>
                      <defs>
                        <linearGradient id="completedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="targetGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" strokeOpacity={0.12} />
                      <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          background: '#ffffff',
                          borderColor: 'rgba(196,198,207,0.9)',
                          borderRadius: '8px',
                          color: '#1a1b1e'
                        }}
                      />
                      <Area type="monotone" dataKey="completed" stroke="#0ea5e9" strokeWidth={2.5} fillOpacity={1} fill="url(#completedGrad)" name="Completion Rate (%)" />
                      <Area type="monotone" dataKey="target" stroke="#7c3aed" strokeWidth={1.5} strokeDasharray="4 4" fillOpacity={1} fill="url(#targetGrad)" name="Target SLA (%)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Right Column: Supervising Authority, Directory, Hierarchy */}
          <div className="space-y-6">
            {/* Supervising Authority */}
            <Card className="glass-panel border-outline-variant bg-surface-container-lowest">
              <CardBody className="p-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant mb-4 flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-secondary" />
                  Supervising Authority
                </h3>
                <div className="flex items-center gap-3.5 bg-surface-container-low p-3 rounded-xl border border-outline-variant">
                  <div className="h-11 w-11 rounded-full bg-secondary-container flex items-center justify-center border border-secondary/20 text-secondary font-bold text-lg shadow-inner">
                    AT
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-on-surface">Dr. Aris Thorne</h4>
                    <p className="text-xs text-secondary font-medium">Chief Road Engineer</p>
                    <p className="text-[10px] text-on-surface-variant">Northwest Institutional Oversight</p>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* On-Site Directory */}
            <Card className="glass-panel border-outline-variant bg-surface-container-lowest">
              <CardBody className="p-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant mb-4 flex items-center gap-2">
                  <Users className="h-4 w-4 text-secondary" />
                  On-Site Directory
                </h3>
                <div className="space-y-3">
                  {[
                    { name: 'Marcus Halloway', role: 'Lead Site Engineer', initials: 'MH', color: 'border-secondary text-secondary' },
                    { name: 'Elena Rodriguez', role: 'Compliance Officer', initials: 'ER', color: 'border-tertiary text-tertiary' },
                    { name: 'Julian Chen', role: 'Logistics Coordinator', initials: 'JC', color: 'border-secondary text-secondary' },
                  ].map((staff) => (
                    <div key={staff.name} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-surface-container-low transition duration-200">
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full border bg-white flex items-center justify-center font-bold text-xs ${staff.color}`}>
                          {staff.initials}
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-on-surface">{staff.name}</h4>
                          <p className="text-[10px] text-on-surface-variant">{staff.role}</p>
                        </div>
                      </div>
                      <Button className="p-1.5 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low">
                        <Phone className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* Unit Hierarchy */}
            <Card className="glass-panel border-outline-variant bg-surface-container-lowest">
              <CardBody className="p-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant mb-4 flex items-center gap-2">
                  <Network className="h-4 w-4 text-secondary" />
                  Unit Hierarchy
                </h3>
                <div className="relative pl-3 border-l-2 border-outline-variant ml-2.5 space-y-4">
                  {[
                    { title: 'Northwest Hub HQ', desc: 'Strategic Oversight', type: 'Hub' },
                    { title: 'Maintenance Unit Alpha', desc: 'Direct Civil Works', type: 'Alpha' },
                    { title: 'Field Response Squads', desc: 'First Response Teams', type: 'Squad' },
                  ].map((unit, idx) => (
                    <div key={unit.title} className="relative">
                      {/* Node circle */}
                      <span className="absolute -left-[19px] top-1 h-3.5 w-3.5 rounded-full bg-white border-2 border-secondary flex items-center justify-center">
                        <span className="h-1 w-1 rounded-full bg-secondary" />
                      </span>
                      <div>
                        <h4 className="text-xs font-bold text-on-surface">{unit.title}</h4>
                        <p className="text-[10px] text-on-surface-variant mt-0.5">{unit.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* Audit / Ledger Badge */}
            <Card className="glass-panel border-outline-variant bg-surface-container-lowest overflow-hidden">
              <div className="bg-secondary-container/20 p-4 border-b border-outline-variant flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-secondary" />
                <h4 className="text-xs font-bold text-on-surface tracking-wide uppercase">Transparency Ledger Active</h4>
              </div>
              <CardBody className="p-4">
                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                  Radical transparency in institutional infrastructure management. Every dispatch, proof upload, and approval signature is anchored in the cryptographically secure transparency ledger.
                </p>
                <div className="mt-3 font-mono text-[9px] text-secondary bg-secondary-container/30 p-2 rounded border border-secondary/10 select-all overflow-hidden text-ellipsis whitespace-nowrap">
                  LEDGER_HASH: 0x82f9c...d81a94e3e5bc
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </Container>
    </div>
  )
}
