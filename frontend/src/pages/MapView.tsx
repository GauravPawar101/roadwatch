import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getActiveRole, getRoleLabel } from '../lib/session'

const roads = [
  { id: 'r1', name: 'NH-48: Pune–Mumbai Bypass', km: '120 km', lat: 18.5204, lng: 73.8567 },
  { id: 'r2', name: 'SH-27: Outer Ring Expressway', km: '45 km', lat: 19.076, lng: 72.8777 },
  { id: 'r3', name: 'NH-66: Coastal Highway Link', km: '200 km', lat: 15.4789, lng: 73.8278 },
]

export default function MapView() {
  const navigate = useNavigate()
  const role = getActiveRole()

  const [layers, setLayers] = useState({
    structural: true,
    lighting: false,
    drainage: true,
    resolved: true
  })

  const [searchQuery, setSearchQuery] = useState('')

  const hotspots = useMemo(() => {
    const list = [
      {
        id: 'hotspot-1',
        type: 'structural',
        top: '33%',
        left: '25%',
        count: 14,
        label: 'CRITICAL SECTOR',
        desc: 'Deep pothole clusters reported on Midtown Link.',
        roadId: 'r1'
      },
      {
        id: 'hotspot-2',
        type: 'lighting',
        top: '50%',
        left: '66%',
        icon: 'warning',
        desc: 'Streetlight outages near exit 4.',
        roadId: 'r2',
        colorClass: 'border-[#1960a3] text-[#1960a3]'
      },
      {
        id: 'hotspot-3',
        type: 'drainage',
        top: '75%',
        left: '50%',
        icon: 'water_drop',
        desc: 'Waterlogged shoulder area on SH-27.',
        roadId: 'r3',
        colorClass: 'border-[#005231] text-[#005231]'
      },
      {
        id: 'hotspot-4',
        type: 'resolved',
        top: '25%',
        left: '75%',
        icon: 'check_circle',
        desc: 'Faded lane markings resolved.',
        roadId: 'r1',
        colorClass: 'border-[#74777f] text-[#74777f] opacity-80'
      }
    ]

    return list.filter((item) => {
      if (!layers[item.type as keyof typeof layers]) return false
      if (searchQuery) {
        return (
          item.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.label?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      }
      return true
    })
  }, [layers, searchQuery])

  return (
    <div className="h-[calc(100vh-64px)] w-full flex flex-col md:flex-row bg-[#f8f9ff] text-[#0b1c30] relative overflow-hidden font-sans">
      
      {/* Side Control Panel: Search and Filters */}
      <aside className="w-full md:w-80 border-r border-[#c4c6cf] bg-white/80 backdrop-blur-md flex flex-col z-20 shrink-0 h-full">
        {/* Sidebar Header */}
        <div className="p-6 border-b border-[#c4c6cf] flex flex-col gap-1">
          <div className="flex items-center justify-between mb-2">
            <span className="px-2.5 py-0.5 rounded-lg bg-[#eff4ff] border border-[#d3e4fe] text-[#1960a3] text-[10px] font-extrabold uppercase tracking-wider">
              {getRoleLabel(role)} Mode
            </span>
            <span className="text-[10px] text-[#74777f] font-bold uppercase tracking-widest">
              Live Layer
            </span>
          </div>
          <h2 className="text-[20px] font-bold text-[#002045] tracking-tight flex items-center gap-2">
            <span className="material-symbols-outlined text-[#1960a3] text-[24px]">map</span>
            Map Explorer
          </h2>
          <p className="text-[#43474e] text-[13px] leading-relaxed">
            Real-time infrastructure grievance monitoring and spatial overlays.
          </p>
        </div>

        {/* Filters and Inputs */}
        <div className="p-6 flex flex-col gap-6 flex-grow overflow-y-auto">
          {/* Search bar */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search coordinates or IDs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#c4c6cf] rounded-lg pr-4 py-2.5 text-[14px] text-[#0b1c30] placeholder:text-[#74777f] focus:outline-none focus:ring-2 focus:ring-[#1960a3]/20 focus:border-[#1960a3] transition-all stitch-pl-10"
            />
            <span className="material-symbols-outlined text-[#74777f] absolute left-3 top-1/2 -translate-y-1/2 text-[18px]">
              search
            </span>
          </div>

          {/* Active Layers checklist */}
          <div className="flex flex-col gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#74777f] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">layers</span> Active Layers
            </h3>

            <div className="flex flex-col gap-2">
              <label className="flex items-center justify-between p-3.5 bg-white border border-[#c4c6cf] rounded-xl cursor-pointer hover:border-[#1960a3] transition-all shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ba1a1a]" />
                  <span className="text-[14px] font-medium text-[#0b1c30]">Road Structural</span>
                </div>
                <input
                  type="checkbox"
                  checked={layers.structural}
                  onChange={(e) => setLayers({ ...layers, structural: e.target.checked })}
                  className="rounded border-[#c4c6cf] text-[#1960a3] focus:ring-[#1960a3] h-4.5 w-4.5 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3.5 bg-white border border-[#c4c6cf] rounded-xl cursor-pointer hover:border-[#1960a3] transition-all shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="text-[14px] font-medium text-[#0b1c30]">Lighting Grid</span>
                </div>
                <input
                  type="checkbox"
                  checked={layers.lighting}
                  onChange={(e) => setLayers({ ...layers, lighting: e.target.checked })}
                  className="rounded border-[#c4c6cf] text-[#1960a3] focus:ring-[#1960a3] h-4.5 w-4.5 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3.5 bg-white border border-[#c4c6cf] rounded-xl cursor-pointer hover:border-[#1960a3] transition-all shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#005231]" />
                  <span className="text-[14px] font-medium text-[#0b1c30]">Drainage Systems</span>
                </div>
                <input
                  type="checkbox"
                  checked={layers.drainage}
                  onChange={(e) => setLayers({ ...layers, drainage: e.target.checked })}
                  className="rounded border-[#c4c6cf] text-[#1960a3] focus:ring-[#1960a3] h-4.5 w-4.5 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3.5 bg-white border border-[#c4c6cf] rounded-xl cursor-pointer hover:border-[#1960a3] transition-all shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#74777f]" />
                  <span className="text-[14px] font-medium text-[#0b1c30]">Resolved Layer</span>
                </div>
                <input
                  type="checkbox"
                  checked={layers.resolved}
                  onChange={(e) => setLayers({ ...layers, resolved: e.target.checked })}
                  className="rounded border-[#c4c6cf] text-[#1960a3] focus:ring-[#1960a3] h-4.5 w-4.5 cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* Tracked Segments list */}
          <div className="flex flex-col gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#74777f] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">sliders</span> Tracked Segments
            </h3>
            <div className="flex flex-col gap-2">
              {roads.map((r) => (
                <div
                  key={r.id}
                  onClick={() => navigate(`/road/${r.id}`)}
                  className="p-3.5 rounded-xl border border-[#c4c6cf] bg-white hover:bg-[#eff4ff] cursor-pointer flex justify-between items-center group transition-all"
                >
                  <div>
                    <span className="text-[14px] font-bold text-[#0b1c30] group-hover:text-[#1960a3] transition-colors">
                      {r.name}
                    </span>
                    <span className="text-[11px] text-[#74777f] block mt-0.5">{r.km}</span>
                  </div>
                  <span className="material-symbols-outlined text-[#74777f] group-hover:text-[#1960a3] group-hover:translate-x-0.5 transition-all text-[18px]">
                    arrow_forward
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Live Feed panel */}
        <div className="p-6 border-t border-[#c4c6cf] bg-white">
          <div className="bg-[#eff4ff] p-4 rounded-xl border border-[#d3e4fe] border-l-4 border-l-[#1960a3] flex flex-col gap-1">
            <span className="text-[10px] font-black text-[#1960a3] uppercase tracking-widest flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] animate-pulse">sensors</span> Live Feed
            </span>
            <p className="text-[12px] text-[#0b1c30] italic leading-relaxed">
              "Major pothole reported on NH-48... routed to contractor squad B."
            </p>
          </div>
        </div>
      </aside>

      {/* Main Map Box */}
      <main className="flex-grow relative overflow-hidden bg-[#eff4ff] flex items-center justify-center">
        {/* Map Visualization */}
        <div className="absolute inset-0 z-0">
          <img
            className="w-full h-full object-cover opacity-30 contrast-75 brightness-110"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuCzuYwB0nM9yGcE-WARkbx_NuIh2fC9Ly1QXia5OFCiqpWC9-gT6T8ldNdA-pUwtgHj88KFPzkDcdd_PlBdt8vl5l-Jvhw39bMefIgYe88gOb4nZro4GUANe-lruJYd1lNIMmEeSZzHFHA-xBzUlJ6j5FOv-vQXCiQOoUk-EXevIVhKAoE-N9rLT8jSf8231yo-L1cA6WJM3eBvPomZ9f7Jj3e136X_d8QhXnUO7ZwvfhnC0rvefMtdVUFnWKMEcodbxoqHmqLud60"
            alt="Map Grid"
          />
          {/* Depth gradients */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#eff4ff] via-transparent to-transparent opacity-60" />
        </div>

        {/* Hotspots layer container */}
        <div className="absolute inset-0 z-10 pointer-events-none">
          <AnimatePresence>
            {hotspots.map((pt) => (
              <motion.div
                key={pt.id}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.3 }}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center cursor-pointer pointer-events-auto"
                style={{ top: pt.top, left: pt.left }}
                onClick={() => navigate(`/road/${pt.roadId}`)}
              >
                {pt.type === 'structural' ? (
                  <div className="relative flex flex-col items-center">
                    <div className="relative">
                      <div className="absolute inset-0 animate-ping rounded-full bg-[#ba1a1a] opacity-30" />
                      <div className="w-12 h-12 bg-white/95 rounded-full flex items-center justify-center border-2 border-[#ba1a1a] shadow-lg hover:scale-105 transition-transform font-bold text-[#ba1a1a] text-[14px]">
                        {pt.count}
                      </div>
                    </div>
                    {pt.label && (
                      <div className="mt-2 bg-[#ba1a1a] text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shadow-sm">
                        {pt.label}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={`w-10 h-10 bg-white/95 rounded-full flex items-center justify-center border-2 shadow-md hover:scale-105 transition-transform ${pt.colorClass}`}>
                    <span className="material-symbols-outlined mat-fill text-[20px]">
                      {pt.icon}
                    </span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Severity Legend (Bottom Right Overlay) */}
        <div className="absolute right-6 bottom-6 z-20">
          <div className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-[#c4c6cf] shadow-xl flex flex-col gap-3 min-w-[220px]">
            <h3 className="text-[12px] font-bold text-[#002045] border-b border-[#c4c6cf] pb-2">
              Severity Scale
            </h3>
            <div className="flex flex-col gap-2.5 text-[13px] text-[#43474e]">
              <div className="flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full bg-[#ba1a1a] ring-2 ring-red-100" />
                <span className="font-medium text-[#0b1c30]">Critical / Emergency</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full bg-amber-400 ring-2 ring-amber-100" />
                <span className="font-medium text-[#0b1c30]">Moderate Concern</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full bg-[#005231] ring-2 ring-emerald-100" />
                <span className="font-medium text-[#0b1c30]">Routine Maintenance</span>
              </div>
              <div className="flex items-center gap-3 opacity-60">
                <span className="w-3.5 h-3.5 rounded-full bg-[#74777f] ring-2 ring-slate-100" />
                <span className="font-medium text-[#0b1c30]">Resolved / Closed</span>
              </div>
            </div>
          </div>
        </div>

        {/* Floating Analytics Compass Overlay */}
        <button className="absolute bottom-6 left-6 z-20 w-14 h-14 rounded-full bg-gradient-to-r from-[#002045] to-[#1960a3] flex items-center justify-center text-white shadow-xl hover:opacity-90 active:scale-95 transition-all md:hidden">
          <span className="material-symbols-outlined text-[24px]">analytics</span>
        </button>
      </main>
    </div>
  )
}
