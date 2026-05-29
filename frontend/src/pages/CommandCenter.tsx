import { useQuery } from '@tanstack/react-query'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { motion } from 'framer-motion'
import {
    Bell,
    Brain,
    CheckCircle2,
    ChevronRight,
    Filter,
    Globe2,
    LayoutDashboard,
    MapPinned,
    MessageSquareMore,
    Search,
    ShieldCheck,
    Sparkles,
    TimerReset,
    Wrench
} from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Line,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from 'recharts'
import { Badge, Button, Card, CardBody, Container, Hero, Input, Select, type BadgeVariant } from '../components/UIComponents'
import {
    authorityProfiles,
    citizenProfile,
    complaintTrends,
    contractorProfiles,
    getAuthorityProfileForLevel,
    getRoleComplaintRows,
    insights,
    jurisdictionMap,
    roleActionLabels,
    roleScopeLabels,
    timelineEvents,
    type AuthorityLevel,
    type ComplaintRecord,
    type DashboardRole,
} from '../data/roadwatchDashboard'
import { useDashboardStore } from '../store/dashboardStore'

type DashboardPayload = {
  title: string
  subtitle: string
  heroNote: string
  summary: Array<{ label: string; value: string; delta: string; icon: JSX.Element }>
}

function resolveRole(input: string | undefined, fallback: DashboardRole): DashboardRole {
  if (input === 'citizen' || input === 'contractor' || input === 'authority' || input === 'super-admin') {
    return input
  }
  return fallback
}

function getPayload(role: DashboardRole, authorityLevel: AuthorityLevel): DashboardPayload {
  const authorityProfile = getAuthorityProfileForLevel(authorityLevel)
  const contractorIdentity = localStorage.getItem('roadwatch_contractor_id') || contractorProfiles[0]?.name
  const contractorProfile = contractorProfiles.find((item) => item.handle === contractorIdentity || item.name === contractorIdentity) ?? contractorProfiles[0]
  const roleRows = getRoleComplaintRows(role, authorityLevel, contractorProfile?.name)
  const openRows = roleRows.filter((item) => item.status !== 'Resolved')
  const severeRows = roleRows.filter((item) => item.severity >= 8)
  const breachRows = roleRows.filter((item) => item.slaHoursLeft <= 12)
  const avgRisk = roleRows.length
    ? Math.round(roleRows.reduce((sum, item) => sum + item.fraudRisk, 0) / roleRows.length)
    : 0

  if (role === 'contractor') {
    return {
      title: 'Contractor command center',
      subtitle: 'Operational view for proof upload, dispatch queues, and region-specific delivery.',
      heroNote: 'Prioritize pending approvals and proof submission before the SLA window closes.',
      summary: [
        { label: 'Assigned works', value: String(roleRows.length), delta: 'Region-linked cases', icon: <Wrench className="stitch-icon-16" /> },
        { label: 'SLA compliance', value: `${Math.max(0, 100 - breachRows.length * 12)}%`, delta: `${breachRows.length} urgent`, icon: <TimerReset className="stitch-icon-16" /> },
        { label: 'Validation score', value: `${Math.max(72, 100 - avgRisk)}%`, delta: 'Complaint risk weighted', icon: <CheckCircle2 className="stitch-icon-16" /> },
        { label: 'Trust score', value: `${contractorProfile?.trustScore ?? 0}`, delta: 'Region-linked profile', icon: <ShieldCheck className="stitch-icon-16" /> },
      ],
    }
  }

  if (role === 'authority') {
    return {
      title: `${authorityProfile.role} control tower`,
      subtitle: `${authorityProfile.scope}. Jurisdiction can switch between ward, district, and state views without leaving the page.`,
      heroNote: 'Use the approval center to assign, escalate, override SLA, and trace every decision in the audit log.',
      summary: [
        { label: 'Open queue', value: String(openRows.length), delta: `${severeRows.length} high severity`, icon: <LayoutDashboard className="stitch-icon-16" /> },
        { label: 'SLA breaches', value: String(breachRows.length), delta: 'Jurisdiction filtered', icon: <TimerReset className="stitch-icon-16" /> },
        { label: 'Fraud risk', value: `${avgRisk}%`, delta: 'Average queue risk', icon: <ShieldCheck className="stitch-icon-16" /> },
        { label: 'Efficiency', value: `${authorityProfile.efficiencyScore}%`, delta: 'Above target', icon: <Brain className="stitch-icon-16" /> },
      ],
    }
  }

  if (role === 'super-admin') {
    return {
      title: 'State-wide oversight console',
      subtitle: 'Cross-district governance, trust monitoring, and performance benchmarking.',
      heroNote: 'Audit authorities, contractors, and trust signals from a single operational dashboard.',
      summary: [
        { label: 'State trust', value: '88', delta: '+3 pts', icon: <Globe2 className="stitch-icon-16" /> },
        { label: 'Fraud flags', value: '17', delta: '+5 watchlist', icon: <ShieldCheck className="stitch-icon-16" /> },
        { label: 'High risk zones', value: '8', delta: '2 critical', icon: <MapPinned className="stitch-icon-16" /> },
        { label: 'Policy health', value: '92%', delta: 'Stable', icon: <Sparkles className="stitch-icon-16" /> },
      ],
    }
  }

  return {
    title: 'Citizen trust dashboard',
    subtitle: 'Track your complaints, credibility score, reward points, and community contribution.',
    heroNote: 'Submit new complaints, monitor timelines, and help validate contractor completion.',
    summary: [
      { label: 'Trust score', value: `${citizenProfile.trustScore}`, delta: '+4 this month', icon: <ShieldCheck className="stitch-icon-16" /> },
      { label: 'Submitted', value: `${citizenProfile.totalSubmitted}`, delta: '18 total', icon: <MessageSquareMore className="stitch-icon-16" /> },
      { label: 'Resolved', value: `${citizenProfile.resolved}`, delta: '61% success', icon: <CheckCircle2 className="stitch-icon-16" /> },
      { label: 'Reward points', value: `${citizenProfile.rewardPoints}`, delta: 'Civic rank rising', icon: <Sparkles className="stitch-icon-16" /> },
    ],
  }
}


function StatTile({ label, value, delta, icon }: { label: string; value: string; delta: string; icon: JSX.Element }) {
  return (
    <motion.div whileHover={{ y: -4 }}>
      <Card>
        <CardBody>
          <div className="stitch-display-flex stitch-justify-between stitch-gap-12">
            <div>
              <div className="stitch-font-700 stitch-text-13 stitch-text-primary">{label}</div>
              <div className="stitch-font-28 stitch-font-900 stitch-mt-8">{value}</div>
            </div>
            <div className="stitch-icon-box">{icon}</div>
          </div>
          <div className="stitch-mt-12 stitch-text-secondary">{delta}</div>
        </CardBody>
      </Card>
    </motion.div>
  )
}

function TrendChart() {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={complaintTrends}>
        <defs>
          <linearGradient id="roadwatchArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0070f3" stopOpacity={0.42} />
            <stop offset="95%" stopColor="#0070f3" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" strokeOpacity={0.18} />
        <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 12 }} />
        <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
        <Tooltip />
        <Area type="monotone" dataKey="citizen" stroke="#0070f3" fill="url(#roadwatchArea)" strokeWidth={2} />
        <Line type="monotone" dataKey="authority" stroke="#22c55e" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="contractor" stroke="#f59e0b" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function PerformanceBars() {
  const data = jurisdictionMap.slice(0, 6).map((item) => ({ name: item.name, openCases: item.openCases, trust: item.trust }))
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="4 4" strokeOpacity={0.18} />
        <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 12 }} />
        <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="openCases" fill="#0070f3" radius={[12, 12, 0, 0]} />
        <Bar dataKey="trust" fill="#22c55e" radius={[12, 12, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function ZonePie() {
  const data = jurisdictionMap.slice(0, 4).map((item) => ({ name: item.name, value: item.risk }))
  const colors = ['#ef4444', '#f59e0b', '#0ea5e9', '#22c55e']
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" innerRadius={66} outerRadius={100} paddingAngle={4}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}

function TrustGraph() {
  const graph = [
    { label: 'Citizen trust', value: citizenProfile.trustScore },
    { label: 'Contractor trust', value: contractorProfiles[0].trustScore },
    { label: 'Authority efficiency', value: authorityProfiles[1].efficiencyScore },
  ]
  return (
    <div className="stitch-display-flex stitch-flex-col stitch-gap-12">
      {graph.map((entry) => (
        <div key={entry.label}>
          <div className="stitch-display-flex stitch-justify-between stitch-items-center stitch-text-13 stitch-font-700 stitch-text-secondary">
            <span>{entry.label}</span>
            <span>{entry.value}%</span>
          </div>
          <div style={{ marginTop: 8, height: 8, overflow: 'hidden', borderRadius: 9999, background: 'var(--color-border)' }}>
            <div style={{ height: '100%', borderRadius: 9999, background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent))', width: String(entry.value) + '%', transition: 'width 600ms ease', animation: 'dashboardFloat 6s ease-in-out infinite' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function JurisdictionHeatmap() {
  return (
    <div className="stitch-grid-auto-fit-220 stitch-gap-12">
      {jurisdictionMap.map((node) => (
        <Card key={node.name}>
          <CardBody>
            <div className="stitch-display-flex stitch-justify-between stitch-items-center">
              <div className="stitch-font-700">{node.name}</div>
              <Badge variant={(node.risk >= 75 ? 'error' : node.risk >= 60 ? 'warning' : 'success') as BadgeVariant}>Risk {node.risk}</Badge>
            </div>
            <div className="stitch-grid stitch-gap-6 stitch-text-secondary" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div>Open cases: {node.openCases}</div>
              <div>SLA breaches: {node.slaBreaches}</div>
              <div>Contractor health: {node.contractorHealth}%</div>
              <div>Trust: {node.trust}%</div>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  )
}

function computeSeverityDisplay(rec: ComplaintRecord): { label: string; variant: BadgeVariant; reasons: string[] } {
  const affected = rec.severity ?? 0
  const baseIndex = affected <= 2 ? 0 : affected <= 10 ? 1 : affected <= 50 ? 2 : affected <= 200 ? 3 : 4

  const titleLower = (rec.title || '').toLowerCase()
  const categoryLower = (rec.category || '').toLowerCase()

  const vulnerable = /school|hospital|clinic|college|children|elderly/.test(titleLower + ' ' + categoryLower)
  const repeat = Boolean(rec.duplicateCluster)
  const highFootfall = /bus stop|station|junction|market|mall|service lane/.test(titleLower + ' ' + categoryLower)
  const slaApproachingBreach = typeof rec.slaHoursLeft === 'number' && rec.slaHoursLeft <= 6

  let bump = 0
  if (vulnerable || repeat || highFootfall) bump += 1
  if (slaApproachingBreach) bump += 1

  const idx = Math.min(4, baseIndex + bump)
  const labels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'EMERGENCY']
  const label = labels[idx]
  const variant: BadgeVariant = idx === 0 ? 'success' : idx === 1 ? 'info' : idx === 2 ? 'warning' : 'error'

  const reasons: string[] = []
  if (vulnerable) reasons.push('Vulnerable area')
  if (repeat) reasons.push('Repeat complaint')
  if (highFootfall) reasons.push('High-footfall')
  if (slaApproachingBreach) reasons.push('SLA near breach')

  return { label, variant, reasons }
}

function ComplaintTable({ role, authorityLevel }: { role: DashboardRole; authorityLevel: AuthorityLevel }) {
  const rows = buildComplaintRows(role, authorityLevel)
  const navigate = useNavigate()
  const columns = useMemo<ColumnDef<ComplaintRecord>[]>(
    () => [
      {
        id: 'severity',
        header: 'Severity',
        cell: (info) => {
          const rec = info.row.original
          const sev = computeSeverityDisplay(rec)
          return (
            <div>
              <Badge variant={sev.variant as BadgeVariant}>{sev.label}</Badge>
              {sev.reasons.length ? <div className="stitch-mt-6 stitch-text-11 stitch-text-secondary">{sev.reasons.join(' · ')}</div> : null}
            </div>
          )
        },
      },
      {
        accessorKey: 'complaintId',
        header: 'Complaint',
        cell: (info) => (
          <div>
            <div className="stitch-font-700 stitch-text-primary">{info.row.original.complaintId}</div>
            <div className="stitch-mt-6 stitch-text-secondary">{info.row.original.title}</div>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: (info) => {
          const val = info.getValue<string>()
          const tone = val === 'Resolved' ? 'success' : val === 'Escalated' ? 'error' : val === 'Pending Approval' ? 'warning' : 'info'
          return <Badge variant={tone as BadgeVariant}>{val}</Badge>
        },
      },
      {
        accessorKey: 'district',
        header: 'Jurisdiction',
        cell: (info) => (
          <div style={{ lineHeight: 1.2 }} className="stitch-text-primary">
            <div className="stitch-font-700">{info.getValue<string>()}</div>
            <div className="stitch-text-12 stitch-text-secondary">{info.row.original.state}</div>
          </div>
        ),
      },
      {
        accessorKey: 'slaHoursLeft',
        header: 'SLA',
        cell: (info) => <span className="stitch-text-primary">{Math.max(info.getValue<number>(), 0)}h left</span>,
      },
      {
        accessorKey: 'fraudRisk',
        header: 'Risk',
        cell: (info) => <span className="stitch-text-primary">{info.getValue<number>()}%</span>,
      },
      {
        id: 'open',
        header: '',
        cell: (info) => (
          <Button variant="primary" size="sm" className="stitch-inline-flex stitch-items-center stitch-gap-6" onClick={() => navigate(`/complaints/${info.row.original.id}`)}>Open <ChevronRight className="stitch-icon-16" /></Button>
        ),
      },
    ],
    []
  )

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <Card>
      <CardBody>
        <div style={{ overflowX: 'auto' }}>
          <table className="stitch-w-100p stitch-text-14" style={{ borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ background: 'var(--color-surface-muted)' }} className="stitch-text-secondary">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className="stitch-p-12 stitch-font-700">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} style={{ transition: 'background .15s ease' }}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="stitch-p-12" style={{ verticalAlign: 'top' }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  )
}

function buildComplaintRows(role: DashboardRole, authorityLevel: AuthorityLevel): ComplaintRecord[] {
  const limit = role === 'citizen' ? 5 : role === 'contractor' ? 6 : role === 'authority' ? 7 : 8
  const contractorName = localStorage.getItem('roadwatch_contractor_id') || contractorProfiles[0]?.name
  return getRoleComplaintRows(role, authorityLevel, contractorName ?? undefined).slice(0, limit)
}

function RoleHighlights({ role }: { role: DashboardRole }) {
  const actionLabels = roleActionLabels[role]

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
      <Card>
        <CardBody>
          <div style={{ fontWeight: 700 }}>AI-generated operational insights</div>
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {insights.map((insight) => (
              <Card key={insight.title}>
                <CardBody>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 700 }}>{insight.title}</div>
                    <Badge variant={(insight.tone === 'good' ? 'success' : insight.tone === 'warning' ? 'warning' : insight.tone === 'danger' ? 'error' : 'info') as BadgeVariant}>{insight.tone}</Badge>
                  </div>
                  <div style={{ marginTop: 8, color: 'var(--color-text-secondary)' }}>{insight.detail}</div>
                </CardBody>
              </Card>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div style={{ fontWeight: 700 }}>Role actions</div>
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {actionLabels.map((action) => (
              <Button key={action} variant="ghost" style={{ textAlign: 'left', padding: 12 }}>{action}</Button>
            ))}
          </div>

          <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: 'linear-gradient(90deg,var(--color-surface),var(--color-primary))', color: 'white' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em' }}>Blockchain anchor verification</div>
            <div style={{ marginTop: 8, fontSize: 18, fontWeight: 900 }}>Hyperledger Fabric reference live</div>
            <p style={{ marginTop: 8, color: 'rgba(255,255,255,0.9)' }}>Every resolution, escalation, and proof submission can be tied to an immutable ledger reference for audit traceability.</p>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

function DashboardHeader({ role, onSwitchRole, onToggleTheme }: { role: DashboardRole; onSwitchRole: (next: DashboardRole) => void; onToggleTheme: () => void }) {
  const jurisdiction = useDashboardStore((state) => state.jurisdiction)
  const setJurisdiction = useDashboardStore((state) => state.setJurisdiction)
  const darkMode = useDashboardStore((state) => state.darkMode)
  const authorityLevel = useDashboardStore((state) => state.authorityLevel)
  const setAuthorityLevel = useDashboardStore((state) => state.setAuthorityLevel)

  return (
    <div style={{
      position: 'sticky',
      top: 53,
      zIndex: 35,
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      background: 'rgba(18, 33, 49, 0.55)',
      backdropFilter: 'blur(16px)',
      boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)'
    }}>
      <Container style={{ maxWidth: 1600, padding: '10px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="prism-gradient" style={{ display: 'flex', height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, color: 'white' }}>
              <MapPinned style={{ height: 18, width: 18 }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 900, background: 'linear-gradient(45deg, #d4e4fa 30%, #8B5CF6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>RoadWatch</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Civic infrastructure accountability & audit network</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {( ['citizen', 'contractor', 'authority', 'super-admin'] as DashboardRole[] ).map((item) => (
              <Button
                key={item}
                variant={role === item ? 'primary' : 'ghost'}
                onClick={() => onSwitchRole(item)}
                style={{ textTransform: 'capitalize', padding: '6px 12px', fontSize: 13 }}
              >
                {item.replace('-', ' ')}
              </Button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input placeholder="Search complaints..." startIcon={<Search style={{ height: 14, width: 14 }} />} style={{ minWidth: 200 }} />

            <Button variant="ghost" onClick={onToggleTheme} style={{ padding: '6px 10px', fontSize: 13 }}>{darkMode ? 'Light ☀️' : 'Dark 🌙'}</Button>

            <Button variant="ghost" style={{ padding: '6px 10px', fontSize: 13 }}><Bell style={{ height: 14, width: 14, marginRight: 4 }} /> Alerts</Button>

            <Button variant="ghost" style={{ padding: '6px 10px', fontSize: 13 }}><Filter style={{ height: 14, width: 14, marginRight: 4 }} /> {jurisdiction}</Button>

            {role === 'authority' ? (
              <Select value={authorityLevel} onChange={(e) => setAuthorityLevel(e.target.value as AuthorityLevel)} style={{ minWidth: 160 }}>
                <option value="junior-engineer">Junior engineer</option>
                <option value="district-officer">District officer</option>
                <option value="chief-engineer">Chief engineer</option>
              </Select>
            ) : null}

            <Select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} style={{ minWidth: 150 }}>
              <option>All districts</option>
              <option>Delhi</option>
              <option>Mumbai</option>
              <option>Pune</option>
              <option>Lucknow</option>
              <option>Bengaluru Urban</option>
              <option>Chennai</option>
            </Select>
          </div>
        </div>
      </Container>
    </div>
  )
}

export default function CommandCenterPage({ defaultRole = 'citizen' }: { defaultRole?: DashboardRole }) {
  const routeParams = useParams()
  const navigate = useNavigate()
  const setRole = useDashboardStore((state) => state.setRole)
  const storedRole = useDashboardStore((state) => state.role)
  const darkMode = useDashboardStore((state) => state.darkMode)
  const setDarkMode = useDashboardStore((state) => state.setDarkMode)
  const authorityLevel = useDashboardStore((state) => state.authorityLevel)

  const currentRole = resolveRole(routeParams.role, storedRole || defaultRole)

  useEffect(() => {
    if (routeParams.role === 'citizen' || routeParams.role === 'contractor' || routeParams.role === 'authority' || routeParams.role === 'super-admin') {
      setRole(routeParams.role)
    }
  }, [routeParams.role, setRole])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  const query = useQuery({
    queryKey: ['roadwatch-dashboard', currentRole, authorityLevel],
    queryFn: async () => {
      await new Promise((resolve) => setTimeout(resolve, 180))
      return getPayload(currentRole, authorityLevel)
    },
  })

  const performanceData = useMemo(() => jurisdictionMap.map((item) => ({ name: item.name, trust: item.trust, risk: item.risk })), [])

  return (
    <div style={{ minHeight: '100vh', color: 'var(--color-text)' }}>
      <DashboardHeader role={currentRole} onSwitchRole={(next) => navigate(`/dashboard/${next}`)} onToggleTheme={() => setDarkMode(!darkMode)} />

      <main style={{ margin: '0 auto', display: 'flex', width: '100%', maxWidth: 1600, flexDirection: 'column', gap: 24, padding: '24px 32px' }}>
        <Container>
          <Hero
            title={query.data?.title ?? 'Loading dashboard...'}
            subtitle={query.data?.subtitle}
            actions={(
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={() => navigate('/complaints')} variant="primary">Open complaint center</Button>
                <Button onClick={() => navigate('/authority/analytics')} variant="ghost">Deep analytics</Button>
                <Button onClick={() => navigate('/contractor/proof/p1')} variant="ghost">Submit proof flow</Button>
              </div>
            )}
          />

          <section style={{ overflow: 'hidden', borderRadius: 32 }}>
            <div style={{ display: 'grid', gap: 24, padding: 24, gridTemplateColumns: '1.2fr 0.8fr' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', padding: '8px 12px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-accent)' }}>
                  {roleScopeLabels[currentRole]}
                </div>
                <div style={{ maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 16, lineHeight: 1.4, color: 'var(--color-muted)' }}>{query.data?.subtitle}</p>
                  <p style={{ maxWidth: '720px', fontSize: 14, lineHeight: 1.45, color: 'var(--color-text-secondary)' }}>{query.data?.heroNote}</p>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <Button onClick={() => navigate('/complaints')} variant="primary">Open complaint center</Button>
                  <Button onClick={() => navigate('/authority/analytics')} variant="ghost">Deep analytics</Button>
                  <Button onClick={() => navigate('/contractor/proof/p1')} variant="ghost">Submit proof flow</Button>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, 1fr)' }}>
                {query.data?.summary.map((item) => (
                  <StatTile key={item.label} label={item.label} value={item.value} delta={item.delta} icon={item.icon} />
                ))}
              </div>
            </div>
          </section>
        </Container>

        <section style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {query.data?.summary.map((item) => (
            <StatTile key={item.label + '-compact'} label={item.label} value={item.value} delta={item.delta} icon={item.icon} />
          ))}
        </section>

        <section style={{ display: 'grid', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <Card>
              <CardBody>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>Live complaint flow</div>
                  <h2 style={{ marginTop: 8, fontSize: 20, fontWeight: 900 }}>Complaint lifecycle, SLA pressure, and trust movement</h2>
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
                  <span style={{ padding: '6px 10px', borderRadius: 999, background: 'var(--chip-bg)', color: 'var(--chip-fg)' }}>Timeline replay</span>
                  <span style={{ padding: '6px 10px', borderRadius: 999, background: 'var(--chip-bg)', color: 'var(--chip-fg)' }}>Status-driven</span>
                  <span style={{ padding: '6px 10px', borderRadius: 999, background: 'var(--chip-bg)', color: 'var(--chip-fg)' }}>Audit aware</span>
                </div>
              </div>
                <div style={{ marginTop: 16, display: 'grid', gap: 16, gridTemplateColumns: '1.15fr 0.85fr' }}>
                  <Card>
                    <CardBody>
                      <TrendChart />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardBody>
                      <div style={{ fontWeight: 700 }}>Trust graph</div>
                      <TrustGraph />
                    </CardBody>
                  </Card>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Operational queue</div>
                    <h2 style={{ marginTop: 8, fontSize: 20, fontWeight: 900 }}>High-priority work items and SLA risk</h2>
                  </div>
                  <Button onClick={() => navigate('/authority/notifications')} variant="secondary">
                    <Bell style={{ height: 16, width: 16, marginRight: 8 }} />
                    Notifications center
                  </Button>
                </div>
                <div style={{ marginTop: 16 }}>
                  <ComplaintTable role={currentRole} authorityLevel={authorityLevel} />
                </div>
              </CardBody>
            </Card>

            <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <Card>
                <CardBody>
                  <div style={{ fontWeight: 700 }}>Jurisdiction intelligence map</div>
                  <div style={{ marginTop: 12 }}>
                    <JurisdictionHeatmap />
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardBody>
                  <div style={{ fontWeight: 700 }}>Approval center and audit timeline</div>
                  <div style={{ marginTop: 12, display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
                    <div>
                      {timelineEvents.map((event) => (
                        <Card key={event.id} style={{ marginBottom: 12 }}>
                          <CardBody>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                              <div style={{ fontWeight: 700 }}>{event.title}</div>
                              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--color-text-secondary)' }}>{event.time}</div>
                            </div>
                            <p style={{ marginTop: 8, color: 'var(--color-text-secondary)' }}>{event.description}</p>
                          </CardBody>
                        </Card>
                      ))}
                    </div>

                    <Card>
                      <CardBody>
                        <div style={{ fontWeight: 700 }}>Fraud + escalation signal</div>
                        <div style={{ marginTop: 12, height: 220 }}>
                          <ZonePie />
                        </div>
                        <div style={{ marginTop: 12, display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                          <div style={{ borderRadius: 12, padding: 12, background: 'rgba(254,226,226,0.6)', color: 'var(--color-danger)' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>Likely fraud</div>
                            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900 }}>3</div>
                          </div>
                          <div style={{ borderRadius: 12, padding: 12, background: 'rgba(255,249,230,0.6)', color: 'var(--color-warning)' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>SLA critical</div>
                            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900 }}>5</div>
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  </div>
                </CardBody>
              </Card>
            </div>

            <RoleHighlights role={currentRole} />
          </div>

          <aside>
            <Card>
              <CardBody>
                <div style={{ fontWeight: 700 }}>Role overview</div>
                <div style={{ marginTop: 8, fontSize: 18, fontWeight: 900 }}>{currentRole.replace('-', ' ')}</div>
                <div style={{ marginTop: 8, color: 'var(--color-text-secondary)' }}>{roleScopeLabels[currentRole]} with jurisdiction-aware filtering and audit-ready workflows.</div>
                <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                  <div style={{ padding: 12, borderRadius: 12, background: 'var(--card-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 700 }}>High risk zones</div>
                    <div style={{ marginTop: 8, fontSize: 16, fontWeight: 800 }}>South Delhi, New Delhi</div>
                  </div>
                  <div style={{ padding: 12, borderRadius: 12, background: 'var(--card-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 700 }}>SLA critical cases</div>
                    <div style={{ marginTop: 8, fontSize: 16, fontWeight: 800 }}>9 active escalation windows</div>
                  </div>
                  <div style={{ padding: 12, borderRadius: 12, background: 'var(--card-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 700 }}>Top contractor</div>
                    <div style={{ marginTop: 8, fontSize: 16, fontWeight: 800 }}>SuperBuild Infra</div>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card style={{ marginTop: 12 }}>
              <CardBody>
                <div style={{ fontWeight: 700 }}>District performance comparison</div>
                <div style={{ marginTop: 12 }}>
                  <PerformanceBars />
                </div>
              </CardBody>
            </Card>

            <Card style={{ marginTop: 12 }}>
              <CardBody>
                <div style={{ fontWeight: 700 }}>Approval shortcuts</div>
                <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Assign contractor</div>
                    <div style={{ color: 'var(--color-text-secondary)', marginTop: 6 }}>Route unresolved work to a certified delivery partner.</div>
                    <div style={{ marginTop: 8 }}><Button variant="ghost">Assign</Button></div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700 }}>Escalate or reopen</div>
                    <div style={{ color: 'var(--color-text-secondary)', marginTop: 6 }}>Push critical items to the next authority tier.</div>
                    <div style={{ marginTop: 8 }}><Button variant="ghost">Escalate</Button></div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700 }}>Generate compliance report</div>
                    <div style={{ color: 'var(--color-text-secondary)', marginTop: 6 }}>Export an audit-grade summary for oversight.</div>
                    <div style={{ marginTop: 8 }}><Button variant="ghost">Export</Button></div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </aside>
        </section>

        <Card>
          <CardBody>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700 }}>Super admin and governance lens</div>
                <h2 style={{ marginTop: 8, fontSize: 20, fontWeight: 900 }}>System trust, policy intelligence, and state-wide benchmarking</h2>
              </div>
              <Button onClick={() => navigate('/authority/analytics')} variant="secondary">Open analytics board</Button>
            </div>

            <div style={{ marginTop: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {insights.map((insight) => (
                <Card key={'admin-' + insight.title}>
                  <CardBody>
                    <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-secondary)' }}>{insight.title}</div>
                    <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.45, color: 'var(--color-text-secondary)' }}>{insight.detail}</p>
                  </CardBody>
                </Card>
              ))}
            </div>

            <div style={{ marginTop: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div style={{ borderRadius: 18, padding: 20, background: 'linear-gradient(135deg, var(--color-foreground), var(--color-primary))', color: 'white' }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.85)' }}>Trust graph</div>
                <div style={{ marginTop: 12, fontSize: 28, fontWeight: 900 }}>88.4</div>
                <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.45, color: 'rgba(255,255,255,0.9)' }}>Weighted across citizen credibility, contractor validation, and authority efficiency.</p>
              </div>

              <Card>
                <CardBody>
                  <div style={{ fontWeight: 700 }}>Contractor network intelligence</div>
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {contractorProfiles.map((contractor) => (
                      <div key={contractor.name} style={{ borderRadius: 12, padding: 12, background: 'var(--card-bg)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ fontWeight: 700 }}>{contractor.name}</div>
                          <div style={{ borderRadius: 999, background: 'rgba(16,185,129,0.1)', padding: '4px 8px', fontSize: 12, fontWeight: 800, color: 'var(--color-success)' }}>{contractor.certificationStatus}</div>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 14, color: 'var(--color-text-secondary)' }}>Regions: {contractor.regions.join(', ')}</div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardBody>
                  <div style={{ fontWeight: 700 }}>Authority performance benchmark</div>
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {authorityProfiles.map((authority) => (
                      <div key={authority.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, padding: 12, background: 'var(--card-bg)' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{authority.name}</div>
                          <div style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>{authority.role}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 20, fontWeight: 900 }}>{authority.efficiencyScore}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>efficiency</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </div>
          </CardBody>
        </Card>
      </main>
    </div>
  )
}
