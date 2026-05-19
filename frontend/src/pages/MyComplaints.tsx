import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listRecords, saveRecord } from '../lib/offlineStore'

type Complaint = {
  id: string
  roadId: string
  title: string
  status: string
  createdAt: string
  severity?: number
  damageType?: string
  description?: string
  slaRemaining?: string
}

export default function MyComplaints() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  
  // Filters State
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All Statuses')
  const [categoryFilter, setCategoryFilter] = useState('All Infrastructure')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [appliedStatus, setAppliedStatus] = useState('All Statuses')
  const [appliedCategory, setAppliedCategory] = useState('All Infrastructure')

  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  useEffect(() => {
    listRecords<Complaint>('complaints')
      .then((records) => {
        // Seed with high-fidelity mock data matching Stitch mockup exactly if empty
        if (records.length === 0) {
          const seed: Complaint[] = [
            {
              id: 'GRI-92381',
              roadId: 'Sector 4, North Ring Road (Near Junction 12)',
              title: 'Major Pothole Cluster on Main St.',
              status: 'Under Review',
              createdAt: '2026-05-18T10:24:00Z',
              severity: 5,
              damageType: 'Potholes & Roads',
              description: 'Multiple deep depressions across three lanes causing significant traffic slowdown and vehicle damage.',
              slaRemaining: '48h remaining'
            },
            {
              id: 'GRI-92385',
              roadId: 'Oakwood Avenue, West Wing',
              title: 'Streetlight Failure - Sector 7',
              status: 'Pending Verification',
              createdAt: '2026-05-17T02:15:00Z',
              severity: 3,
              damageType: 'Street Lighting',
              description: 'Three consecutive streetlights are out, making the pedestrian crossing hazardous during night hours.',
              slaRemaining: 'Overdue (12h)'
            },
            {
              id: 'GRI-92102',
              roadId: 'Riverside Drive',
              title: 'Clogged Storm Drain',
              status: 'Resolved',
              createdAt: '2026-05-15T12:00:00Z',
              severity: 2,
              damageType: 'Water & Sewage',
              description: 'Debris build-up preventing water flow during light rain. Maintenance completed on Oct 18.',
              slaRemaining: 'Closed: Oct 20, 2024'
            }
          ]
          // Save seeds to store
          seed.forEach(item => saveRecord('complaints', item.id, item))
          setItems(seed)
        } else {
          setItems(records)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  // Apply search & advanced filter logic
  const handleApplyFilters = () => {
    setAppliedSearch(searchQuery)
    setAppliedStatus(statusFilter)
    setAppliedCategory(categoryFilter)
  }

  // Filter complaints based on applied filter state
  const filteredItems = items.filter((c) => {
    const matchesSearch =
      c.title.toLowerCase().includes(appliedSearch.toLowerCase()) ||
      c.roadId.toLowerCase().includes(appliedSearch.toLowerCase()) ||
      c.id.toLowerCase().includes(appliedSearch.toLowerCase())

    const matchesStatus =
      appliedStatus === 'All Statuses' ||
      c.status === appliedStatus ||
      (appliedStatus === 'Pending' && (c.status === 'Pending Verification' || c.status === 'Pending' || c.status === 'Submitted'))

    const matchesCategory =
      appliedCategory === 'All Infrastructure' ||
      c.damageType === appliedCategory ||
      (appliedCategory === 'Potholes & Roads' && (c.damageType?.includes('Pothole') || c.damageType?.includes('Road'))) ||
      (appliedCategory === 'Street Lighting' && (c.damageType?.includes('Light') || c.damageType?.includes('Sign'))) ||
      (appliedCategory === 'Water & Sewage' && (c.damageType?.includes('Drain') || c.damageType?.includes('Sewage') || c.damageType?.includes('Water'))) ||
      (appliedCategory === 'Waste Management' && c.damageType?.includes('Waste'))

    return matchesSearch && matchesStatus && matchesCategory
  })

  // Dynamic Metrics Counts
  const totalCount = items.length
  const activeCount = items.filter(c => c.status !== 'Resolved').length
  const resolvedCount = items.filter(c => c.status === 'Resolved').length

  const getDamageImage = (type?: string) => {
    if (!type) return 'https://images.unsplash.com/photo-1515162305285-0293e4767cc2?auto=format&fit=crop&w=600&q=80'
    const lower = type.toLowerCase()
    if (lower.includes('pothole') || lower.includes('road')) {
      return 'https://lh3.googleusercontent.com/aida-public/AB6AXuDPNTkaJUnqX_EFkar8AKewvHycKMjpA-wE259tfwFyWR0lckoNx7sTb7oryt7EKUPPMUev_Uz02cwspbET2D6geCb6Gp6KV_Notn2sX2QOlTjBihwdwy8-Jc7X9rB7XdLtMBSGxVcsYrEbYjCNKqEr2S1KhdA-_BpTuCpfp-Rlm22o2IZaNqDrnu-D9vYuK6NzejbAYuh6b5cI58W5rLcvR_5U_Mpt7ZL2xOF2KMQKTTiHyUG22_YbyXiL_bSJJsVO8-02a24IJF8'
    }
    if (lower.includes('light') || lower.includes('sign')) {
      return 'https://lh3.googleusercontent.com/aida-public/AB6AXuCrLVldHOFdcJbfG9GlBvLW2ur0CjJEyFP7obd2IxhUytUDK4ANlTtvu69_1niFSM-gYxuOI_JvKLrAOPvYrMIVJLK5I_5AyTD-l-gQdosvVS3NlDl-Om1kDW-JtBy85FMaOhitHNEN-G3UNMdkG7sJ1KgzIzxGRrGxVuCeWtmh72vC2zWbJVadeVgbJs-ql-GYG8emnqW1geAtGLvNK8d6eE0_9VtPjWQfuhAqO889a2QnlSjIhm7BGEnTQ1blN2NQIov9Lyyf4UU'
    }
    return 'https://lh3.googleusercontent.com/aida-public/AB6AXuDJs__yYAeKbG1Mcg1cUE01X53MqopPwBPq3lh8FpEH0zQ2nRlzD-GXfm3sVCXewmM4JaIt4gD5c1mD9sJCeE6K1hKihq1zQ5sPqK8hpUzosmsS2ZrmyvGKXAUHDXix5wkuoSjp2QMWrGBE3z2psw5-bhjBfpaP3FEoFnu8SBAfU7mwD8aP_qMaoJgY1OVbp4hu2aHWCWslkM6gTbSeWa1lf9zM2ennWRnzGoZhwgW6WCUcMyJDccnVm1XOGHNEX1FxW5O__zNsviQ'
  }

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0b1c30] font-sans pb-20">
      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-24 right-6 z-50 bg-[#1960a3] text-white px-5 py-3 rounded-xl font-bold shadow-xl flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[20px] animate-pulse">done_all</span>
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-[1280px] mx-auto w-full px-4 md:px-16 py-12">
        {/* Header Section */}
        <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-[30px] font-bold text-[#002045] leading-[38px] mb-2">Track Progress</h1>
            <p className="text-[16px] leading-[24px] text-[#43474e] max-w-2xl">
              Manage and monitor your reported infrastructure issues. Radical transparency for institutional accountability.
            </p>
          </div>
          <div className="flex gap-4">
            <div className="bg-white border border-[#d3e4fe] shadow-sm px-6 py-3 rounded-xl flex items-center gap-3">
              <span className="text-[24px] font-semibold text-[#1960a3]">
                {String(activeCount).padStart(2, '0')}
              </span>
              <span className="text-[14px] font-bold text-[#74777f] uppercase tracking-wider">Active</span>
            </div>
            <div className="bg-white border border-[#d3e4fe] shadow-sm px-6 py-3 rounded-xl flex items-center gap-3">
              <span className="text-[24px] font-semibold text-[#005231]">
                {String(resolvedCount).padStart(2, '0')}
              </span>
              <span className="text-[14px] font-bold text-[#74777f] uppercase tracking-wider">Resolved</span>
            </div>
          </div>
        </div>

        {/* FilterBar Component */}
        <section className="bg-[#eff4ff] border border-[#d3e4fe] rounded-xl p-6 mb-8 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="space-y-2">
              <label className="text-[14px] font-semibold text-[#0b1c30]">Search Query</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#74777f] text-[18px]">search</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleApplyFilters()
                  }}
                  className="w-full bg-white border border-[#c4c6cf] rounded-lg pr-4 py-2.5 text-[16px] focus:ring-2 focus:ring-[#1960a3]/20 focus:border-[#1960a3] outline-none transition-all stitch-pl-10"
                  placeholder="Road name, ID..."
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-[14px] font-semibold text-[#0b1c30]">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full bg-white border border-[#c4c6cf] rounded-lg px-4 py-2.5 text-[16px] focus:ring-2 focus:ring-[#1960a3]/20 focus:border-[#1960a3] outline-none cursor-pointer appearance-none"
              >
                <option value="All Statuses">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Under Review">Under Review</option>
                <option value="Resolved">Resolved</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[14px] font-semibold text-[#0b1c30]">Category</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full bg-white border border-[#c4c6cf] rounded-lg px-4 py-2.5 text-[16px] focus:ring-2 focus:ring-[#1960a3]/20 focus:border-[#1960a3] outline-none cursor-pointer appearance-none"
              >
                <option value="All Infrastructure">All Infrastructure</option>
                <option value="Potholes & Roads">Potholes & Roads</option>
                <option value="Street Lighting">Street Lighting</option>
                <option value="Water & Sewage">Water & Sewage</option>
                <option value="Waste Management">Waste Management</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={handleApplyFilters}
                className="w-full bg-white hover:bg-[#dce9ff] transition-colors py-2.5 rounded-lg text-[14px] font-bold text-[#002045] border border-[#c4c6cf] shadow-sm flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                Apply Advanced Filters
              </button>
            </div>
          </div>
        </section>

        {/* Complaints Listing */}
        {loading ? (
          <div className="flex justify-center items-center py-24">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1960a3]" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white border border-dashed border-[#c4c6cf] rounded-xl p-16 text-center flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-[#eff4ff] flex items-center justify-center text-[#74777f]">
              <span className="material-symbols-outlined text-[32px]">folder_open</span>
            </div>
            <h3 className="text-[18px] font-bold text-[#002045]">No complaints matched your search</h3>
            <p className="text-[#74777f] text-[14px] max-w-sm leading-relaxed">
              Try adjusting your query or filters. Help keep your community safe by reporting new road hazards.
            </p>
            <button
              onClick={() => navigate('/road/r1/report')}
              className="mt-2 bg-[#002045] text-white px-6 py-2.5 rounded-lg font-bold text-[14px] hover:bg-[#1960a3] transition-all shadow-sm"
            >
              Report New Issue
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredItems.map((c, idx) => {
              const isCritical = (c.severity || 0) >= 4
              const isMedium = (c.severity || 0) === 3
              const isResolved = c.status === 'Resolved'

              // Status styles mapping
              let statusLabel = c.status
              let statusColorClass = 'text-[#74777f]'
              let statusDotColorClass = 'bg-[#74777f]'

              if (isResolved) {
                statusLabel = 'Resolved'
                statusColorClass = 'text-[#005231]'
                statusDotColorClass = 'bg-[#005231]'
              } else if (c.status.includes('Review')) {
                statusLabel = 'Under Review'
                statusColorClass = 'text-[#1960a3]'
                statusDotColorClass = 'bg-[#1960a3]'
              } else {
                statusLabel = 'Pending Verification'
                statusColorClass = 'text-[#74777f]'
                statusDotColorClass = 'bg-[#74777f]'
              }

              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.05 }}
                  className="bg-white border border-[#d3e4fe] shadow-sm rounded-xl overflow-hidden group hover:border-[#1960a3]/50 transition-all cursor-pointer"
                  onClick={() => navigate(`/complaints/${c.id}`)}
                >
                  <div className="flex flex-col md:flex-row">
                    {/* Left Thumbnail Image */}
                    <div className="w-full md:w-64 h-48 md:h-auto overflow-hidden bg-[#e5eeff] relative shrink-0">
                      <img
                        alt={c.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        src={getDamageImage(c.damageType)}
                      />
                    </div>

                    {/* Right Card Contents */}
                    <div className="flex-grow p-6 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start mb-2">
                          {isCritical ? (
                            <span className="text-[10px] bg-[#ba1a1a]/10 text-[#ba1a1a] px-2 py-1 rounded font-bold uppercase tracking-widest border border-[#ba1a1a]/20">
                              Critical Severity
                            </span>
                          ) : isMedium ? (
                            <span className="text-[10px] bg-[#1960a3]/10 text-[#1960a3] px-2 py-1 rounded font-bold uppercase tracking-widest border border-[#1960a3]/20">
                              Medium Severity
                            </span>
                          ) : (
                            <span className="text-[10px] bg-[#eff4ff] text-[#43474e] px-2 py-1 rounded font-bold uppercase tracking-widest border border-[#c4c6cf]">
                              Low Severity
                            </span>
                          )}
                          <span className="text-[14px] text-[#74777f]">
                            Ref: #{c.id}
                          </span>
                        </div>

                        <h3 className="text-[20px] font-bold text-[#002045] group-hover:text-[#1960a3] transition-colors mb-1">
                          {c.title}
                        </h3>

                        <div className="flex items-center gap-1 text-[#43474e] mb-4">
                          <span className="material-symbols-outlined text-[18px] text-[#1960a3]">location_on</span>
                          <span className="text-[16px]">{c.roadId}</span>
                        </div>

                        <p className="text-[16px] text-[#43474e] line-clamp-2 leading-relaxed">
                          {c.description || 'No detailed description provided.'}
                        </p>
                      </div>

                      {/* SLA & Actions panel */}
                      <div className="mt-6 pt-4 border-t border-[#dce9ff] flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-6">
                          <div className="flex items-center gap-1.5">
                            {isResolved ? (
                              <span className="material-symbols-outlined mat-fill text-[#005231] text-[20px]">
                                check_circle
                              </span>
                            ) : (
                              <div className={`w-2.5 h-2.5 rounded-full ${statusDotColorClass}`} />
                            )}
                            <span className={`text-[14px] font-bold ${statusColorClass}`}>
                              {statusLabel}
                            </span>
                          </div>
                          <div className="text-[14px] text-[#43474e]">
                            SLA: <span className="font-semibold text-[#0b1c30]">{c.slaRemaining || 'Pending SLA Assign'}</span>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/complaints/${c.id}`)
                          }}
                          className="text-[#1960a3] text-[14px] font-bold flex items-center gap-1 hover:text-[#002045] transition-colors"
                        >
                          View Full Timeline 
                          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* Pagination Component */}
        <nav className="mt-16 flex flex-col md:flex-row justify-between items-center gap-6 border-t border-[#c4c6cf] pt-8">
          <span className="text-[16px] text-[#43474e]">
            Showing <span className="text-[#002045] font-bold">1-{filteredItems.length}</span> of <span className="text-[#002045] font-bold">{filteredItems.length}</span> reports
          </span>
          <div className="flex items-center gap-2">
            <button className="w-10 h-10 flex items-center justify-center rounded-lg border border-[#c4c6cf] text-[#74777f] hover:text-[#002045] hover:border-[#002045] transition-all disabled:opacity-30" disabled>
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <button className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#002045] text-white font-bold shadow-sm">1</button>
            <button className="w-10 h-10 flex items-center justify-center rounded-lg border border-[#c4c6cf] text-[#43474e] hover:bg-[#eff4ff] transition-all" disabled>2</button>
            <button className="w-10 h-10 flex items-center justify-center rounded-lg border border-[#c4c6cf] text-[#43474e] hover:bg-[#eff4ff] transition-all" disabled>3</button>
            <span className="text-[#74777f] px-2">...</span>
            <button className="w-10 h-10 flex items-center justify-center rounded-lg border border-[#c4c6cf] text-[#43474e] hover:bg-[#eff4ff] transition-all" disabled>7</button>
            <button className="w-10 h-10 flex items-center justify-center rounded-lg border border-[#c4c6cf] text-[#74777f] hover:text-[#002045] hover:border-[#002045] transition-all" disabled>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </nav>
      </main>
    </div>
  )
}
