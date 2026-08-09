import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Wrench,
  Clock,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  FileText,
  UserCheck,
  Sparkles,
  Inbox,
  Filter,
  Plus
} from 'lucide-react'
import { Badge, Button, Card, CardBody, Container, Spinner } from '../components/UIComponents'
import { useContractorComplaints } from '../hooks/useContractorComplaints'
import { apiFetch } from '../lib/api'

type Complaint = {
  id: string
  title: string
  desc: string
  severity: number
  status: 'Pending' | 'In Progress' | 'Resolved'
  roadName: string
  date: string
}

function mapAssignmentStatus(status: string | null, complaintStatus: string): Complaint['status'] {
  const s = String(status || complaintStatus).toUpperCase()
  if (s.includes('RESOLV') || s === 'COMPLETED') return 'Resolved'
  if (s.includes('ACCEPT') || s.includes('PROGRESS') || s === 'INPROGRESS') return 'In Progress'
  return 'Pending'
}

export default function ComplaintsOnMyRoads() {
  const navigate = useNavigate()
  const { complaints: apiComplaints, loading, error, refetch } = useContractorComplaints()
  const [filter, setFilter] = useState<'All' | 'Pending' | 'In Progress' | 'Resolved'>('All')

  const complaints: Complaint[] = useMemo(
    () =>
      apiComplaints.map((c) => ({
        id: c.id,
        title: c.description?.slice(0, 60) || `Complaint ${c.id}`,
        desc: c.description || '',
        severity: c.progressPct != null ? Math.min(5, Math.ceil(c.progressPct / 20)) : 3,
        status: mapAssignmentStatus(c.assignmentStatus, c.status),
        roadName: [c.district, c.zone].filter(Boolean).join(' · ') || c.id,
        date: c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '—',
      })),
    [apiComplaints],
  )

  async function updateStatus(id: string, newStatus: 'In Progress' | 'Resolved') {
    try {
      if (newStatus === 'In Progress') {
        await apiFetch(`/contractor/complaints/${id}/accept`, { method: 'POST' })
        alert(`Dispatch for ${id} accepted.`)
      } else {
        await apiFetch(`/contractor/complaints/${id}/complete`, {
          method: 'POST',
          body: JSON.stringify({ resolutionReport: { note: 'Marked complete from portal' } }),
        })
        alert(`Resolution submitted for ${id}.`)
      }
      refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed')
    }
  }

  const filtered = complaints.filter((c) => {
    if (filter === 'All') return true
    return c.status === filter
  })

  // Get dynamic counts for stats badges
  const pendingCount = complaints.filter((c) => c.status === 'Pending').length
  const progressCount = complaints.filter((c) => c.status === 'In Progress').length

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner className="h-8 w-8 text-[#06B6D4]" />
      </div>
    )
  }

  return (
    <Container>
      <div className="space-y-6 pb-12">
        {/* Navigation & Title */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/dashboard/contractor')}
              className="p-2 border border-white/10 text-slate-300 hover:text-white bg-slate-900/40 rounded-xl"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#06B6D4]">
                  Operational Dispatch Queue
                </p>
              </div>
              <h1 className="text-2xl font-black text-white mt-1">Complaints On My Roads</h1>
              <p className="text-slate-400 text-xs mt-0.5">
                Contractor: <span className="text-white font-bold">{contractorId}</span> | ID: <span className="font-mono text-cyan-400">NW-827-2</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center bg-slate-950/40 p-1.5 rounded-xl border border-white/5">
            {[
              { id: 'All', label: 'Show All' },
              { id: 'Pending', label: 'Pending Dispatches', count: pendingCount, color: 'bg-red-500/20 text-red-400' },
              { id: 'In Progress', label: 'In Progress', count: progressCount, color: 'bg-[#8B5CF6]/20 text-[#8B5CF6]' },
              { id: 'Resolved', label: 'Resolved' }
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setFilter(btn.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center gap-1.5 ${
                  filter === btn.id
                    ? 'bg-gradient-to-r from-[#002045] to-[#1960a3] text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {btn.label}
                {btn.count !== undefined && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${btn.color}`}>
                    {btn.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Complaints Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main List */}
          <div className="lg:col-span-2 space-y-4">
            {filtered.map((item) => (
              <motion.div
                key={item.id}
                layout
                whileHover={{ scale: 1.005 }}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#122131]/40 backdrop-blur p-5 transition-all duration-300 hover:border-white/20"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[#06B6D4] bg-cyan-950/40 border border-cyan-800/30 px-2 py-0.5 rounded">
                        {item.id}
                      </span>
                      <span className="text-xs text-slate-400 font-semibold flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-500" />
                        Logged {item.date}
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-white group-hover:text-cyan-300 transition-colors mt-2">
                      {item.title}
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed mt-1">
                      {item.desc}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 pt-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Inbox className="h-3.5 w-3.5 text-yellow-500" />
                        Road: <strong className="text-slate-200">{item.roadName}</strong>
                      </span>
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                        Severity Score: <strong className="text-red-400">{item.severity}/5</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex sm:flex-col gap-2 min-w-[120px] self-end sm:self-start">
                    {/* Status Badge */}
                    <div className="text-center sm:text-right mb-1">
                      <Badge
                        tone={
                          item.status === 'Resolved'
                            ? 'success'
                            : item.status === 'In Progress'
                            ? 'warning'
                            : 'error'
                        }
                        className="px-2.5 py-0.5 text-[9px] uppercase tracking-wider font-extrabold"
                      >
                        {item.status}
                      </Badge>
                    </div>

                    {/* Action buttons based on status */}
                    {item.status === 'Pending' && (
                      <Button
                        onClick={() => updateStatus(item.id, 'In Progress')}
                        className="w-full text-xs font-bold py-2 bg-gradient-to-r from-[#002045] to-[#1960a3] hover:opacity-95 text-white rounded-lg flex items-center justify-center gap-1 shadow-sm"
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        Accept Dispatch
                      </Button>
                    )}

                    {item.status === 'In Progress' && (
                      <Button
                        onClick={() => updateStatus(item.id, 'Resolved')}
                        className="w-full text-xs font-bold py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center justify-center gap-1 shadow-sm"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Log Resolution
                      </Button>
                    )}

                    {item.status === 'Resolved' && (
                      <div className="flex items-center justify-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/20 border border-emerald-500/20 p-2 rounded-lg">
                        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>Closed & Signed</span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}

            {filtered.length === 0 && (
              <Card className="glass-card border-white/5 bg-[#122131]/20 backdrop-blur py-16 text-center">
                <CardBody className="space-y-3">
                  <Inbox className="h-10 w-10 text-slate-600 mx-auto" />
                  <h4 className="text-sm font-bold text-white">No Tickets in this Queue</h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    All citizen reports for this status have been addressed. Select another filter from the navigation bar.
                  </p>
                </CardBody>
              </Card>
            )}
          </div>

          {/* Right Column details */}
          <div className="space-y-6">
            {/* Quick Summary stats info */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-5 space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <Filter className="h-4 w-4 text-[#06B6D4]" />
                  Operational Stats
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-950/40 p-3.5 rounded-xl border border-white/5 text-center">
                    <span className="text-[9px] text-slate-500 block uppercase font-bold">Unclaimed Work</span>
                    <strong className="text-2xl font-black text-red-400">{pendingCount}</strong>
                  </div>
                  <div className="bg-slate-950/40 p-3.5 rounded-xl border border-white/5 text-center">
                    <span className="text-[9px] text-slate-500 block uppercase font-bold">In Remediation</span>
                    <strong className="text-2xl font-black text-[#8B5CF6]">{progressCount}</strong>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* SLA Guidelines */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
              <CardBody className="p-5 space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 animate-pulse" />
                  SLA Timeline Requirements
                </h3>
                <div className="space-y-2 text-xs text-slate-300">
                  <div className="flex items-start gap-2">
                    <span className="text-red-400 font-bold">Severity 5:</span>
                    <span>Action required within 12 hours. Severe structural hazard.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-yellow-500 font-bold">Severity 3-4:</span>
                    <span>Action required within 36 hours. General remediation.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-slate-400 font-bold">Severity 1-2:</span>
                    <span>Action required within 72 hours. Minor aesthetic repairs.</span>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Cryptographic anchoring detail */}
            <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur overflow-hidden">
              <div className="bg-gradient-to-r from-[#06B6D4]/10 to-[#8B5CF6]/10 p-4 border-b border-white/5 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Secured Dispatch Node</h4>
              </div>
              <CardBody className="p-4 space-y-2">
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Every acceptance click, dispatch initiation, and final logged resolution is stamped with a unique cryptographic signature.
                </p>
                <div className="font-mono text-[9px] text-[#8B5CF6] bg-purple-950/20 p-2 rounded border border-purple-500/10 overflow-hidden text-ellipsis whitespace-nowrap select-all">
                  NODE_ADDR: 0x92bE7...E1A9
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </Container>
  )
}
