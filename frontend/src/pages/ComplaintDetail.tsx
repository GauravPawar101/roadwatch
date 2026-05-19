import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getRecord } from '../lib/offlineStore'

type Complaint = {
  id: string
  title: string
  roadId: string
  damageType: string
  severity: number
  status: string
  anchored_at?: string | null
  anchored_tx_hash?: string | null
  fabric_txid?: string | null
  createdAt: string
  slaDeadline: string
  routedTo: string
  location?: { lat?: number; lng?: number }
  media?: Array<{ id: string; type: 'photo' | 'video'; dataUrl?: string; status: string; timestamp: string }>
  notes?: string
}

type ComplaintUpload = {
  complaintId: string
  roadId?: string
  uploadId?: string
  ipfs?: string
  sha?: string
  filename?: string
  completedAt?: string
}

export default function ComplaintDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [complaint, setComplaint] = useState<Complaint | null>(null)
  const [upload, setUpload] = useState<ComplaintUpload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getRecord('complaints', String(id)),
      getRecord('complaint_uploads', String(id)),
    ])
      .then(([found, foundUpload]) => {
        setComplaint((found as Complaint) || null)
        setUpload((foundUpload as ComplaintUpload) || null)
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f9ff] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1960a3]" />
      </div>
    )
  }

  const currentComplaint = complaint || {
    id: id || 'IGP-88291-TX',
    title: 'Major Pothole & Structural Degradation: West 14th St',
    roadId: 'West 14th St, Austin, TX',
    damageType: 'Pothole',
    severity: 5,
    status: 'In Progress',
    createdAt: '2026-05-18T10:24:00Z',
    slaDeadline: '2026-05-25T10:24:00Z',
    routedTo: 'Austin Road Services (Team B)',
    location: { lat: 30.2672, lng: -97.7431 },
    notes: 'Severe safety hazard observed near intersection. Highly prone to accidents.'
  }

  function normalizeStatusDisplay(status: string) {
    const s = String(status || '').toUpperCase()
    if (s === 'FILED' || s === 'PENDING' || s === 'SUBMITTED') return 'Submitted'
    if (s === 'IN_PROGRESS' || s === 'IN PROGRESS') return 'In Progress'
    if (s === 'RESOLVED') return 'Resolved'
    return status || 'In Progress'
  }

  const displayStatus = normalizeStatusDisplay(currentComplaint.status)

  const timelineEvents = [
    {
      title: 'Contractor Arrived & Site Survey',
      desc: `${currentComplaint.routedTo || 'Austin Road Services (Team B)'} completed initial depth measurements and core sampling.`,
      time: 'Today, 10:24 AM',
      active: true
    },
    {
      title: 'Resource Allocation',
      desc: 'Emergency repair materials dispatched from Central Depot. ETA 4 hours.',
      time: 'Oct 25, 02:15 PM',
      active: false
    },
    {
      title: 'Verified by AI Inspector',
      desc: `Structural integrity risk score: ${(currentComplaint.severity || 5) * 1.68}/10. Case prioritized for 24-hour resolution.`,
      time: 'Oct 24, 05:40 PM',
      active: false
    },
    {
      title: 'Report Filed',
      desc: 'Grievance submitted via Community Portal with photo evidence attached.',
      time: new Date(currentComplaint.createdAt).toLocaleString(),
      active: false
    }
  ]

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0b1c30] py-12 px-6 selection:bg-[#1960a3]/20 font-sans">
      
      <div className="max-w-[1280px] mx-auto">
        {/* Navigation Back */}
        <button
          onClick={() => navigate('/complaints')}
          className="mb-8 px-4 py-2 rounded-lg border border-[#c4c6cf] hover:bg-[#eff4ff] text-[#43474e] hover:text-[#0b1c30] transition-all flex items-center gap-2 text-sm font-semibold cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Back to My History</span>
        </button>

        {/* Hero Title Section */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-3 py-1 rounded-full bg-[#d3e4ff]/60 text-[#00477f] font-bold text-[12px] uppercase select-none">
              {displayStatus}
            </span>
            <span className="text-[#43474e] text-[12px] uppercase tracking-widest font-bold">
              Case #IGP-{currentComplaint.id}
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-[#0b1c30] mb-4 tracking-tight leading-tight">
            {currentComplaint.title}
          </h1>
          <div className="flex flex-wrap items-center gap-6 text-[#43474e] text-sm">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[#1960a3] text-[18px]">calendar_today</span>
              <span>Reported: {new Date(currentComplaint.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[#1960a3] text-[18px]">location_on</span>
              <span>{currentComplaint.roadId}</span>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Column: Evidence & Timeline */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* Evidence Gallery */}
            <section className="bg-white border border-[#dce9ff] rounded-xl p-6 shadow-sm">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-[20px] font-bold text-[#0b1c30]">Evidence Gallery</h2>
                <button className="text-[#1960a3] font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 hover:underline cursor-pointer">
                  <span className="material-symbols-outlined text-[18px]">download</span> Download All
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="aspect-video rounded-lg overflow-hidden group relative cursor-pointer border border-[#c4c6cf] bg-[#eff4ff]">
                  <img
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuCDaucMZaLdgP1BjhVaufppsq-8SIEUNsvVd3I_3Jg0yJVuaYkd2YAasQELvjpnPZpg5nski_eqgee-565h0V_A3VhJzXjHijiczRBl8HLcohL5SofwKYglQgFlOYB9GFDYBC_MvfR_Ldy9IBwBJYoYy3s2kPW02hNkwsQ0S9QNjaecH_jqDkeHqXPkuTpiSKnYzh_ZcSrWGXwjVXR8ij15HMiVVelkJNzxS3F8Usy5Fg4WPj07m5bTc5QB_PB5b8SCgyi0u_oo-gw"
                    alt="Core Damage"
                  />
                  <div className="absolute inset-0 bg-[#002045]/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="material-symbols-outlined text-white text-[24px]">zoom_in</span>
                  </div>
                </div>

                <div className="aspect-video rounded-lg overflow-hidden group relative cursor-pointer border border-[#c4c6cf] bg-[#eff4ff]">
                  <img
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuBHMLQF3ghgNGc3PrQYeVFpoh7pgAAUsBR5WX8xNsHmI4TwaHOsdWCBq3HN_XuC6plXJ67UCkMfk9GQjF8hLoktBzLTbdTxO1WgRSBTksek0D15ugLBp60t4JcwhSSktY9DnZtg9WzuFevZjeLyHcDgkEYOOpGIAqELnMtYAddXqerSrK37Rg0TmASPSjfD5RtV2AK2xWTk3aZMXKkrsS7Flst1mzGvtOZMJr10xEMCp-3YToArmz12_uxiqL0TydDmDRAtA7lz3s4"
                    alt="Road Area Damage"
                  />
                  <div className="absolute inset-0 bg-[#002045]/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="material-symbols-outlined text-white text-[24px]">zoom_in</span>
                  </div>
                </div>

                <div className="aspect-video rounded-lg overflow-hidden group relative cursor-pointer border border-[#c4c6cf] bg-[#eff4ff]">
                  <img
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuArUwo3FZLRVRss9HX8eOR8-t8N-8sJmdQIPqIz7h8E7xrhWqU9vyejXm3Ql5PExbam3CZkFaWWukUD2gBA2AIqJHnt_PWSidlj3FvAXFFB4RMVxaIdl04fWJwCHeHCbfIOdCTFKOTm3ZH71Tql-TsBaQY-hERq3awaKyL_ufEd7oLETHvuKeLghwSmfWzaBRPSVKxyeLb5Msn75BF9r173YmKBCRzbOGFOWwthJuPjUsexYhbW3_KAykQiYg6ihoYWNoCSc0YnISI"
                    alt="Structural crack depth"
                  />
                  <div className="absolute inset-0 bg-[#002045]/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="material-symbols-outlined text-white text-[24px]">zoom_in</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Blockchain Anchoring Block */}
            {upload?.ipfs && (
              <section className="bg-white border border-[#dce9ff] rounded-xl p-6 shadow-sm flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-600 text-[22px]">verified_user</span>
                  <h3 className="text-[16px] font-bold text-[#0b1c30]">Blockchain Proof Integrity</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                  <div className="bg-[#f8f9ff] p-3 rounded-lg border border-[#c4c6cf]/60">
                    <span className="text-[#74777f] block uppercase tracking-wider mb-1">IPFS CID</span>
                    <span className="text-[#1960a3] break-all">{upload.ipfs}</span>
                  </div>
                  <div className="bg-[#f8f9ff] p-3 rounded-lg border border-[#c4c6cf]/60">
                    <span className="text-[#74777f] block uppercase tracking-wider mb-1">SHA-256 Checksum</span>
                    <span className="text-[#0b1c30] break-all">{upload.sha || 'Pending verification'}</span>
                  </div>
                </div>
              </section>
            )}

            {/* Progress Timeline */}
            <section className="bg-white border border-[#dce9ff] rounded-xl p-6 shadow-sm">
              <h2 className="text-[20px] font-bold text-[#0b1c30] mb-8">Progress Timeline</h2>
              <div className="relative pl-8 border-l border-[#dce9ff] space-y-8">
                {timelineEvents.map((ev, idx) => (
                  <div key={idx} className="relative">
                    {/* Event Indicator Pin */}
                    <div className="absolute -left-[45px] top-1 w-6 h-6 rounded-full bg-white border-2 border-[#1960a3] flex items-center justify-center z-10 shadow-sm">
                      <div className={`w-2 h-2 rounded-full ${ev.active ? 'bg-[#1960a3]' : 'bg-[#c4c6cf]'}`} />
                    </div>

                    <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-2">
                      <div>
                        <h3 className="text-[16px] font-bold text-[#0b1c30]">
                          {ev.title}
                        </h3>
                        <p className="text-[#43474e] text-sm leading-relaxed mt-1">{ev.desc}</p>
                      </div>
                      <span className="text-xs font-medium text-[#74777f] shrink-0 bg-[#eff4ff] px-2.5 py-1 rounded border border-[#d3e4fe]">
                        {ev.time}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Right Column: Location map & Institutional Actions */}
          <div className="lg:col-span-4 space-y-6">
            {/* Map Card */}
            <section className="bg-white border border-[#dce9ff] rounded-xl overflow-hidden shadow-sm">
              <div className="p-6">
                <h2 className="text-[20px] font-bold text-[#0b1c30] mb-1">Incident Location</h2>
                <div className="flex items-center gap-1.5 text-xs text-[#43474e]">
                  <span className="material-symbols-outlined text-[14px]">pin_drop</span>
                  <span>
                    {currentComplaint.location?.lat?.toFixed(4) || '30.2672'}° N,{' '}
                    {currentComplaint.location?.lng?.toFixed(4) || '-97.7431'}° W
                  </span>
                </div>
              </div>
              <div className="h-64 relative bg-[#eff4ff] overflow-hidden border-t border-[#dce9ff] group">
                <img
                  className="w-full h-full object-cover grayscale opacity-85 group-hover:scale-105 duration-1000"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAZ3pE3z0KD0ZDkxScI5FI8fQPz8z5VI5m3YXe7c3HyDseS93serQzFIn7qz3SUih1iCHWYQ-NrzvV3YHz__H4eU_C4BAauP6Pl_lDjq_qIqM6qGTSnEAhOdg8uFDr0AP6F7BiMKJ1qV0Ls3kQHeHqlUGT3iUD0XyU-9OPiTRBkKUS90EEwgUmUDcRn2I8VMs8yA3z6U28kbpqRxUp50ETpxPZGRziP0QeoG5UCQTr4H8kFLhGDMteZ9MCIEAo-RaQmKt1WpC5kX_w"
                  alt="Incident Map Grid"
                />
                <button className="absolute bottom-4 right-4 bg-gradient-to-r from-[#002045] to-[#1960a3] p-3 rounded-lg shadow-xl text-white hover:opacity-90 active:scale-95 transition-all">
                  <span className="material-symbols-outlined text-white">directions</span>
                </button>
              </div>
            </section>

            {/* Actions Card */}
            <section className="bg-white border border-[#dce9ff] rounded-xl p-6 shadow-sm flex flex-col gap-5">
              <h2 className="text-[20px] font-bold text-[#0b1c30]">Institutional Actions</h2>
              <div className="flex flex-col gap-3">
                <button className="w-full py-3 rounded-lg bg-gradient-to-r from-[#002045] to-[#1960a3] hover:opacity-95 text-white font-bold text-[14px] flex items-center justify-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer">
                  <span className="material-symbols-outlined text-white">verified</span> Verify Resolution
                </button>
                <Link to={`/escalate/${currentComplaint.id}`} className="w-full">
                  <button className="w-full py-3 rounded-lg bg-[#eff4ff] hover:bg-[#d3e4fe] border border-[#c4c6cf] text-[#0b1c30] font-bold text-[14px] flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer">
                    <span className="material-symbols-outlined text-amber-600">report_problem</span> Escalate Case
                  </button>
                </Link>
                <button className="w-full py-3 rounded-lg bg-[#eff4ff] hover:bg-[#d3e4fe] border border-[#c4c6cf] text-[#0b1c30] font-bold text-[14px] flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer">
                  <span className="material-symbols-outlined text-[#1960a3]">chat_bubble</span> Contact Ombudsman
                </button>
              </div>

              {/* Assignment Authority Footer inside card */}
              <div className="border-t border-[#c4c6cf]/60 pt-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#d3e4ff]/40 flex items-center justify-center text-[#1960a3] shrink-0">
                  <span className="material-symbols-outlined text-[20px]">account_balance</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#74777f] block uppercase font-bold tracking-wider">Assigned Authority</span>
                  <span className="text-sm font-semibold text-[#0b1c30] truncate max-w-[200px] block">
                    {currentComplaint.routedTo || 'Austin Road Services (Team B)'}
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
