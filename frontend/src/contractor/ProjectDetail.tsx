import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Wrench,
  Clock,
  ArrowLeft,
  Camera,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  User,
  ShieldAlert,
  DollarSign,
  Activity,
  HardHat,
  FileText,
  ShieldCheck,
  ExternalLink
} from 'lucide-react'
import { Badge, Button, Card, CardBody, Container, Spinner } from '../components/UIComponents'
import { getRecord } from '../lib/offlineStore'

const trend = [72, 70, 68, 66, 67, 69, 71, 73, 74, 76]

function Sparkline() {
  const width = 300
  const height = 80
  const min = Math.min(...trend)
  const max = Math.max(...trend)
  const points = trend.map((v, i) => {
    const x = (i / (trend.length - 1)) * width
    const y = height - ((v - min) / (max - min || 1)) * height
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[80px] bg-slate-950/40 rounded-xl border border-white/5">
      <defs>
        <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.2} />
          <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke="#06B6D4" strokeWidth="2.5" points={points} strokeLinecap="round" strokeLinejoin="round" />
      <path d={`M 0 ${height} L ${points} L ${width} ${height} Z`} fill="url(#sparklineGrad)" />
    </svg>
  )
}

export default function ContractorProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [upload, setUpload] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)

  const project = {
    id,
    roadName: id === 'p1' ? 'NH-48 Section 3' : id === 'p2' ? 'SH-27 Bypass' : 'MDR-11 Link Road',
    title: 'North-South Bridge Seismic Retrofit',
    subtitle: 'Implementation of advanced seismic dampers and structural reinforcement on the main support pylons to comply with 2024 Institutional Infrastructure Safety Standards.',
    contractValue: id === 'p1' ? '₹120 Cr' : id === 'p2' ? '₹45 Cr' : '₹18 Cr',
    sanctioned: id === 'p1' ? '₹90 Cr' : id === 'p2' ? '₹35 Cr' : '₹14 Cr',
    released: id === 'p1' ? '₹68 Cr' : id === 'p2' ? '₹24 Cr' : '₹11 Cr',
    spent: id === 'p1' ? '₹54 Cr' : id === 'p2' ? '₹19 Cr' : '₹9.2 Cr',
    scope: 'Widening, resurfacing, high-tensile steel sleeve reinforcement, underwater sonar testing, and drainage improvements.',
    engineer: 'Dr. Elena Rodriguez',
    completion: id === 'p1' ? '2026-11-30' : id === 'p2' ? '2026-06-30' : '2025-12-14',
    condition: id === 'p1' ? '74/100' : id === 'p2' ? '84/100' : '63/100',
    authority: 'Municipal Infrastructure Bureau'
  }

  const workQueue = [
    { title: 'Foundation Pylon reinforcement', desc: 'Installation of high-tensile steel sleeves around base of Pylon C-4.', status: 'Pending' },
    { title: 'Underwater Inspection', desc: 'Sonar imaging and diver inspection of sub-surface concrete integrity.', status: 'Pending' }
  ]

  const visualHistory = [
    { title: 'Material Delivery Verified', desc: 'Batch #829 Steel Sleeves arrived on site. QR scan confirmed by Logistics Lead.', time: '2 hours ago' },
    { title: 'Phase 2 Documentation Signed', desc: 'Authority official Elena Rodriguez digitally signed the structural readiness report for Section B.', time: '1 day ago' },
    { title: 'Weather Delay Logged', desc: 'High winds exceeded safety threshold for crane operation. Work suspended for 4 hours.', time: '3 days ago' }
  ]

  const complaints = [
    { id: 'RW-2024-00431', severity: 4, title: 'Major structural fissure - KM 42.5', desc: 'Deep crack spanning two lanes; posing immediate risk to heavy transport vehicles.' },
    { id: 'RW-2024-00444', severity: 2, title: 'Downed Directional Signage - Sector Exit', desc: 'The main exit sign for Sector 7 has been damaged by high winds and is blocking the shoulder.' },
  ]

  useEffect(() => {
    getRecord('contractor_uploads', String(id))
      .then((found) => setUpload(found || null))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="flex min-h-[400px] items-center justify-center">
      <Spinner className="h-8 w-8 text-[#06B6D4]" />
    </div>
  )

  return (
    <Container>
      <div className="space-y-6 pb-12">
        {/* Back and Action Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => navigate('/dashboard/contractor')}
            className="flex items-center gap-2 border border-white/10 text-slate-300 hover:text-white bg-slate-900/40 rounded-xl px-4 py-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Button>
          <div className="flex gap-2">
            <Link to={`/contractor/proof/${id}`}>
              <Button variant="primary" className="flex items-center gap-2 bg-gradient-to-r from-[#002045] to-[#1960a3] hover:opacity-95 text-white">
                <Camera className="h-4 w-4" />
                Upload Progress Proof
              </Button>
            </Link>
            <Link to={`/contractor/complaints`}>
              <Button variant="ghost" className="border border-white/10 text-slate-300 hover:text-white bg-white/5 hover:bg-white/10">
                View Complaints
              </Button>
            </Link>
          </div>
        </div>

        {/* Project Header Info */}
        <div className="rounded-2xl border border-white/10 bg-[#122131]/40 backdrop-blur p-6 relative overflow-hidden">
          <div className="absolute right-0 top-0 h-40 w-40 bg-gradient-to-br from-[#06B6D4]/10 to-[#8B5CF6]/10 rounded-bl-full blur-2xl" />
          <div className="relative space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="success" className="px-3 py-1 font-bold text-[10px] tracking-wider uppercase">
                Active Project
              </Badge>
              <span className="text-xs text-slate-400 font-mono">Contract ID: {project.id}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white">
              {project.roadName} — {project.title}
            </h1>
            <p className="text-slate-300 text-sm leading-relaxed max-w-4xl">
              {project.subtitle}
            </p>
          </div>
        </div>

        {/* Financial Overview Tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Contract Value', val: project.contractValue, icon: <DollarSign className="h-4.5 w-4.5 text-cyan-400" /> },
            { label: 'Sanctioned Budget', val: project.sanctioned, icon: <DollarSign className="h-4.5 w-4.5 text-purple-400" /> },
            { label: 'Released Funds', val: project.released, icon: <DollarSign className="h-4.5 w-4.5 text-emerald-400" /> },
            { label: 'Total Spent', val: project.spent, icon: <DollarSign className="h-4.5 w-4.5 text-yellow-500" /> },
          ].map((tile) => (
            <Card key={tile.label} className="glass-card bg-slate-900/20 hover:border-white/20 transition-all duration-200">
              <CardBody className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{tile.label}</p>
                  <h4 className="text-xl font-black text-white mt-1">{tile.val}</h4>
                </div>
                <div className="p-2 bg-white/5 rounded-lg border border-white/10">{tile.icon}</div>
              </CardBody>
            </Card>
          ))}
        </div>

        {/* Two-Column Details */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Scope, Work Queue, Visual History */}
          <div className="lg:col-span-2 space-y-6">
            {/* Scope details */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-6">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-[#06B6D4]" />
                  Project Scope & Details
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed mb-4">
                  {project.scope}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-slate-950/40 p-4 rounded-xl border border-white/5 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Supervising Official</p>
                    <p className="text-sm font-bold text-white">{project.engineer}</p>
                    <p className="text-[11px] text-cyan-400">{project.authority}</p>
                  </div>
                  <div className="bg-slate-950/40 p-4 rounded-xl border border-white/5 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Target Completion</p>
                    <p className="text-sm font-bold text-white flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-purple-400" />
                      {project.completion}
                    </p>
                    <p className="text-[11px] text-purple-400">In DLP Mode Post-Completion</p>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Work Queue */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Wrench className="h-5 w-5 text-[#8B5CF6]" />
                    Required Dispatches / Work Queue
                  </h3>
                  <Badge tone="warning" className="px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold">
                    {workQueue.length} Pending
                  </Badge>
                </div>
                <div className="space-y-3">
                  {workQueue.map((wq) => (
                    <div key={wq.title} className="p-3.5 rounded-xl border border-white/5 bg-slate-950/20 flex items-start justify-between gap-4">
                      <div>
                        <h4 className="text-sm font-bold text-white">{wq.title}</h4>
                        <p className="text-xs text-slate-400 mt-1">{wq.desc}</p>
                      </div>
                      <Badge tone="warning" className="text-[10px] px-2 py-0.5">
                        {wq.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* Visual History Log */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-6">
                <h3 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-emerald-400" />
                  Visual History & Event Log
                </h3>
                <div className="relative pl-4 border-l border-white/10 ml-2 space-y-5">
                  {visualHistory.map((item) => (
                    <div key={item.title} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-950 border border-emerald-400 flex items-center justify-center">
                        <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
                      </span>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-4">
                          <h4 className="text-xs font-bold text-white">{item.title}</h4>
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {item.time}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Right Column: Trend sparkline, Latest uploads, Open complaints */}
          <div className="space-y-6">
            {/* Condition Trend Sparkline */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-5 space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[#06B6D4]" />
                  Road Condition Trend
                </h3>
                <Sparkline />
                <div className="flex justify-between items-center bg-slate-950/20 p-3 rounded-lg border border-white/5">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Current Score</span>
                    <strong className="text-2xl font-black text-white">{project.condition}</strong>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Trend status</span>
                    <Badge tone="success" className="text-[9px] px-2 py-0.5">📈 Improving</Badge>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Offline Upload Registry */}
            {upload?.ipfs ? (
              <Card className="glass-card border-[#06B6D4]/30 bg-[#06B6D4]/5 backdrop-blur">
                <CardBody className="p-5 space-y-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Latest Verified Proof
                  </h3>
                  <div className="text-xs text-slate-300 space-y-1.5 font-mono">
                    <div className="flex justify-between border-b border-white/5 pb-1">
                      <span className="text-slate-400">PHASE:</span>
                      <span className="text-white font-bold">{upload.phase}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-1">
                      <span className="text-slate-400">COMPLETED:</span>
                      <span className="text-white font-bold">{new Date(upload.completedAt).toLocaleDateString()}</span>
                    </div>
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap pt-1">
                      <span className="text-slate-400 font-mono">CID: </span>
                      <span className="text-cyan-300 text-[10px] select-all">{upload.ipfs}</span>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ) : (
              <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
                <CardBody className="p-5 text-center">
                  <Camera className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                  <h4 className="text-xs font-bold text-white">No Proof Uploaded Yet</h4>
                  <p className="text-[11px] text-slate-400 mt-1">Upload signed visual evidence to verify active milestone achievements.</p>
                </CardBody>
              </Card>
            )}

            {/* Project Personnel */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                  <HardHat className="h-4 w-4 text-[#8B5CF6]" />
                  Assigned Personnel
                </h3>
                <div className="space-y-3">
                  {[
                    { name: 'Mark Thompson', role: 'Lead Structural Foreman', icon: <User className="h-3.5 w-3.5" /> },
                    { name: 'Sarah Chen', role: 'Compliance Officer', icon: <User className="h-3.5 w-3.5" /> },
                  ].map((p) => (
                    <div key={p.name} className="flex items-center gap-2.5 bg-slate-900/30 p-2.5 rounded-lg border border-white/5">
                      <div className="h-7 w-7 rounded-full bg-purple-950 flex items-center justify-center text-purple-300 text-xs font-bold">
                        {p.name.split(' ').map(n=>n[0]).join('')}
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">{p.name}</h4>
                        <p className="text-[9px] text-slate-400">{p.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* Complaints list */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-red-400" />
                  Active Grievance Tickets
                </h3>
                <div className="space-y-3">
                  {complaints.map((c) => (
                    <div key={c.id} className="p-2.5 rounded-lg border border-red-500/10 bg-red-950/10 space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono text-red-400">{c.id}</span>
                        <Badge tone={c.severity >= 4 ? 'error' : 'warning'} className="text-[9px] px-1.5 py-0.2">
                          Severity {c.severity}
                        </Badge>
                      </div>
                      <h4 className="text-xs font-bold text-white leading-tight">{c.title}</h4>
                      <p className="text-[10px] text-slate-400 leading-normal">{c.desc}</p>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* Ledger Audit Footer */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400 animate-pulse" />
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Governing Transparency Audit</h4>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  All activity on this project is registered in the public Transparency Ledger.
                </p>
                <div className="font-mono text-[9px] text-slate-400 bg-slate-950/60 p-2 rounded border border-white/5 overflow-hidden text-ellipsis whitespace-nowrap">
                  LEDGER_HASH: 4x9f2c8d21a94e3e5bc82a01e
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </Container>
  )
}
