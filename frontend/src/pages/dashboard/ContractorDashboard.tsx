import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Wrench,
  FolderOpen,
  ShieldCheck,
  Users,
  Activity,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Phone,
  FileText,
  UserCheck,
  Network,
  Clock
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { Badge, Button, Card, CardBody, Container } from '../../components/UIComponents'

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

export default function ContractorDashboard() {
  const navigate = useNavigate()
  const contractorName = localStorage.getItem('roadwatch_contractor_id') || 'Global Infra Corp'
  const [projects] = useState(seedProjects)

  return (
    <Container>
      <div className="space-y-6 pb-12">
        {/* Header Block */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#06B6D4]">
                Northwest Sector • Active Hub
              </p>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              Regional Maintenance Hub
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Welcome back, <span className="text-white font-semibold">{contractorName}</span>. Lead Contractor Space.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => navigate('/contractor/vault')}
              className="glass-card flex items-center gap-2 border-white/10 text-white hover:bg-white/10"
            >
              <FolderOpen className="h-4 w-4 text-[#06B6D4]" />
              Document Vault
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate('/contractor/complaints')}
              className="glass-card flex items-center gap-2 border-white/10 text-white hover:bg-white/10"
            >
              <Wrench className="h-4 w-4 text-[#8B5CF6]" />
              Work Queue
            </Button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div whileHover={{ y: -4 }} className="transition-all duration-300">
            <Card className="glass-card border-red-500/30 bg-red-950/20">
              <CardBody className="p-5">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-red-400">SLA Breaches</p>
                    <h3 className="text-3xl font-black text-white mt-1">12</h3>
                  </div>
                  <div className="p-2.5 bg-red-500/10 rounded-xl border border-red-500/20">
                    <AlertTriangle className="h-5 w-5 text-red-400" />
                  </div>
                </div>
                <p className="text-xs text-red-300/80 mt-3 font-medium">⚠️ Action required on M4 Corridor</p>
              </CardBody>
            </Card>
          </motion.div>

          <motion.div whileHover={{ y: -4 }} className="transition-all duration-300">
            <Card className="glass-card border-[#8B5CF6]/30 bg-[#8B5CF6]/5">
              <CardBody className="p-5">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-purple-400">Open Cases</p>
                    <h3 className="text-3xl font-black text-white mt-1">45</h3>
                  </div>
                  <div className="p-2.5 bg-purple-500/10 rounded-xl border border-purple-500/20">
                    <Wrench className="h-5 w-5 text-purple-400" />
                  </div>
                </div>
                <p className="text-xs text-purple-300/80 mt-3 font-medium">⚡ 8 active dispatches in queue</p>
              </CardBody>
            </Card>
          </motion.div>

          <motion.div whileHover={{ y: -4 }} className="transition-all duration-300">
            <Card className="glass-card border-[#06B6D4]/30 bg-[#06B6D4]/5">
              <CardBody className="p-5">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-cyan-400">Regional Coverage</p>
                    <h3 className="text-3xl font-black text-white mt-1">75%</h3>
                  </div>
                  <div className="p-2.5 bg-cyan-500/10 rounded-xl border border-cyan-500/20">
                    <Activity className="h-5 w-5 text-cyan-400" />
                  </div>
                </div>
                <p className="text-xs text-cyan-300/80 mt-3 font-medium">✓ Targeted quota achieved</p>
              </CardBody>
            </Card>
          </motion.div>

          <motion.div whileHover={{ y: -4 }} className="transition-all duration-300">
            <Card className="glass-card border-emerald-500/30 bg-emerald-950/20">
              <CardBody className="p-5">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Field Response</p>
                    <h3 className="text-3xl font-black text-white mt-1">Active</h3>
                  </div>
                  <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                    <ShieldCheck className="h-5 w-5 text-emerald-400" />
                  </div>
                </div>
                <p className="text-xs text-emerald-300/80 mt-3 font-medium">🔒 All field units active & safe</p>
              </CardBody>
            </Card>
          </motion.div>
        </div>

        {/* Dashboard Panels Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left / Middle: Projects & Velocity Chart */}
          <div className="lg:col-span-2 space-y-6">
            {/* Assigned Projects Card */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Wrench className="h-5 w-5 text-[#06B6D4]" />
                      Assigned Infrastructure Projects
                    </h3>
                    <p className="text-slate-400 text-xs mt-1">
                      Manage progress, upload cryptographically signed proofs, and monitor active complaints.
                    </p>
                  </div>
                  <Badge tone="success" className="px-3 py-1 font-semibold uppercase tracking-wider text-[10px]">
                    {projects.length} Assigned
                  </Badge>
                </div>

                <div className="space-y-4">
                  {projects.map((p) => (
                    <motion.div
                      key={p.id}
                      whileHover={{ scale: 1.01 }}
                      className="group relative overflow-hidden rounded-xl border border-white/5 bg-slate-900/50 p-4 transition-all duration-300 hover:border-[#06B6D4]/30 hover:bg-slate-900/80"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold uppercase tracking-wider text-cyan-400 px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-800/30">
                              {p.type}
                            </span>
                            <h4 className="text-base font-bold text-white group-hover:text-cyan-300 transition-colors">
                              {p.roadName}
                            </h4>
                          </div>
                          <p className="text-xs text-slate-400">
                            Timeline: <span className="text-slate-300">{p.start}</span> to <span className="text-slate-300">{p.end}</span>
                          </p>
                          <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-400">
                            <span className="flex items-center gap-1">
                              <Activity className="h-3.5 w-3.5 text-yellow-500" />
                              Phase: <strong className="text-slate-200">{p.phase}</strong>
                            </span>
                            <span className="flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                              Active Complaints: <strong className="text-red-400">{p.complaints}</strong>
                            </span>
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                              Health: <strong className="text-emerald-400">{p.condition}/100</strong>
                            </span>
                          </div>
                          {/* Progress bar */}
                          <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mt-3 max-w-md">
                            <div
                              className="bg-gradient-to-r from-[#06B6D4] to-[#8B5CF6] h-full"
                              style={{ width: `${p.completionPercent}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex sm:flex-col gap-2 min-w-[120px]">
                          <Button
                            variant="primary"
                            onClick={() => navigate(`/contractor/project/${p.id}`)}
                            className="w-full text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1 bg-gradient-to-r from-[#002045] to-[#1960a3] hover:opacity-90"
                          >
                            Open Details
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => navigate(`/contractor/proof/${p.id}`)}
                            className="w-full text-xs font-semibold py-2 px-3 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
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

            {/* Velocity Area Chart */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Clock className="h-5 w-5 text-[#8B5CF6]" />
                      Regional Delivery Velocity
                    </h3>
                    <p className="text-slate-400 text-xs mt-1">
                      Mon-Fri work order completion rates against target thresholds.
                    </p>
                  </div>
                  <Badge tone="success" className="px-3 py-1 font-semibold text-[10px]">
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
                      <CartesianGrid strokeDasharray="4 4" strokeOpacity={0.05} />
                      <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          background: '#0d1c2d',
                          borderColor: 'rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#fff'
                        }}
                      />
                      <Area type="monotone" dataKey="completed" stroke="#06B6D4" strokeWidth={2.5} fillOpacity={1} fill="url(#completedGrad)" name="Completion Rate (%)" />
                      <Area type="monotone" dataKey="target" stroke="#8B5CF6" strokeWidth={1.5} strokeDasharray="4 4" fillOpacity={1} fill="url(#targetGrad)" name="Target SLA (%)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Right Column: Supervising Authority, Directory, Hierarchy */}
          <div className="space-y-6">
            {/* Supervising Authority */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-[#06B6D4]" />
                  Supervising Authority
                </h3>
                <div className="flex items-center gap-3.5 bg-slate-900/30 p-3 rounded-xl border border-white/5">
                  <div className="h-11 w-11 rounded-full bg-cyan-950 flex items-center justify-center border border-cyan-500/20 text-cyan-400 font-bold text-lg shadow-inner">
                    AT
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Dr. Aris Thorne</h4>
                    <p className="text-xs text-cyan-400 font-medium">Chief Road Engineer</p>
                    <p className="text-[10px] text-slate-500">Northwest Institutional Oversight</p>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* On-Site Directory */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                  <Users className="h-4 w-4 text-[#8B5CF6]" />
                  On-Site Directory
                </h3>
                <div className="space-y-3">
                  {[
                    { name: 'Marcus Halloway', role: 'Lead Site Engineer', initials: 'MH', color: 'border-[#06B6D4] text-[#06B6D4]' },
                    { name: 'Elena Rodriguez', role: 'Compliance Officer', initials: 'ER', color: 'border-[#8B5CF6] text-[#8B5CF6]' },
                    { name: 'Julian Chen', role: 'Logistics Coordinator', initials: 'JC', color: 'border-yellow-500 text-yellow-500' },
                  ].map((staff) => (
                    <div key={staff.name} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-white/5 transition duration-200">
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full border bg-slate-900 flex items-center justify-center font-bold text-xs ${staff.color}`}>
                          {staff.initials}
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-white">{staff.name}</h4>
                          <p className="text-[10px] text-slate-400">{staff.role}</p>
                        </div>
                      </div>
                      <Button className="p-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:bg-white/10">
                        <Phone className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* Unit Hierarchy */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                  <Network className="h-4 w-4 text-emerald-400" />
                  Unit Hierarchy
                </h3>
                <div className="relative pl-3 border-l-2 border-slate-700/60 ml-2.5 space-y-4">
                  {[
                    { title: 'Northwest Hub HQ', desc: 'Strategic Oversight', type: 'Hub' },
                    { title: 'Maintenance Unit Alpha', desc: 'Direct Civil Works', type: 'Alpha' },
                    { title: 'Field Response Squads', desc: 'First Response Teams', type: 'Squad' },
                  ].map((unit, idx) => (
                    <div key={unit.title} className="relative">
                      {/* Node circle */}
                      <span className="absolute -left-[19px] top-1 h-3.5 w-3.5 rounded-full bg-slate-950 border-2 border-emerald-500 flex items-center justify-center">
                        <span className="h-1 w-1 rounded-full bg-emerald-400" />
                      </span>
                      <div>
                        <h4 className="text-xs font-bold text-white">{unit.title}</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">{unit.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* Audit / Ledger Badge */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur overflow-hidden">
              <div className="bg-gradient-to-r from-[#06B6D4]/10 to-[#8B5CF6]/10 p-4 border-b border-white/5 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[#06B6D4]" />
                <h4 className="text-xs font-bold text-white tracking-wide uppercase">Transparency Ledger Active</h4>
              </div>
              <CardBody className="p-4">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Radical transparency in institutional infrastructure management. Every dispatch, proof upload, and approval signature is anchored in the cryptographically secure transparency ledger.
                </p>
                <div className="mt-3 font-mono text-[9px] text-[#06B6D4] bg-cyan-950/30 p-2 rounded border border-cyan-500/10 select-all overflow-hidden text-ellipsis whitespace-nowrap">
                  LEDGER_HASH: 0x82f9c...d81a94e3e5bc
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </Container>
  )
}
