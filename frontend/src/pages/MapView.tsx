import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ComplaintHeatmap from '../components/ComplaintHeatmap'
import { useComplaints, type ComplaintFilters } from '../hooks/useComplaints'
import { getActiveRole, getRoleLabel } from '../lib/session'
import { DELHI_CENTER, resolveMapCenter } from '../lib/mapLocation'

const roads = [
  { id: 'r1', name: 'NH-48: Delhi–Jaipur Corridor', km: '120 km', lat: 28.6139, lng: 77.209 },
  { id: 'r2', name: 'Ring Road: Outer Expressway', km: '45 km', lat: 28.7041, lng: 77.1025 },
  { id: 'r3', name: 'NH-24: East Delhi Link', km: '40 km', lat: 28.5355, lng: 77.391 },
]

export default function MapView() {
  const navigate = useNavigate()
  const role = getActiveRole()

  const [layers, setLayers] = useState({ structural: true, lighting: false, drainage: true, resolved: true })
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRoad, setSelectedRoad] = useState<string | null>(null)
  const [mapCenter, setMapCenter] = useState(DELHI_CENTER)

  useEffect(() => {
    let cancelled = false
    resolveMapCenter().then((center) => {
      if (!cancelled) setMapCenter(center)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const filters: ComplaintFilters = useMemo(() => {
    const result: ComplaintFilters = { limit: 1000 };
    const statusFilters: string[] = [];
    if (layers.structural || layers.lighting || layers.drainage) statusFilters.push('Open', 'InProgress');
    if (layers.resolved) statusFilters.push('Resolved');
    if (statusFilters.length) result.status = statusFilters.join(',');
    return result;
  }, [layers]);

  const { complaints, loading } = useComplaints(filters);

  const [heatmapData, setHeatmapData] = useState<any[]>([])
  const [heatmapLoading, setHeatmapLoading] = useState(false)

  useEffect(() => {
    const fetchHeatmapData = async () => {
      setHeatmapLoading(true)
      try {
        const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100'
        const token = localStorage.getItem('roadwatch_token')
        if (!token) return
        const params = new URLSearchParams()
        if (filters.status) params.append('status', filters.status)
        const resp = await fetch(`${apiBase}/complaints/heatmap/data?${params.toString()}`, { headers: { 'Authorization': `Bearer ${token}` } })
        if (resp.ok) { const data = await resp.json(); setHeatmapData(data.heatmapData || []) }
      } catch (err) {
        console.error('Failed to fetch heatmap data:', err)
      } finally { setHeatmapLoading(false) }
    }
    fetchHeatmapData()
  }, [filters])

  const regionSummaries = useMemo(() => {
    const grouped = new Map<string, { count: number; severe: number; resolved: number }>()
    for (const complaint of complaints) {
      const key = complaint.district || complaint.zone || complaint.roadId || 'Unknown region'
      const current = grouped.get(key) ?? { count: 0, severe: 0, resolved: 0 }
      current.count += 1
      if (complaint.severity >= 4) current.severe += 1
      if (complaint.status === 'Resolved') current.resolved += 1
      grouped.set(key, current)
    }
    return [...grouped.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5)
  }, [complaints])

  const mapModeLabel = complaints.length >= 20 ? 'Regional heatmap' : selectedRoad ? 'Focused route view' : 'Local pin view'

  const handleComplaintClick = (c: { id: string }) => navigate(`/complaints/${c.id}`)

  return (
    <div className="page-radial-bg h-[calc(100vh-64px)] w-full flex flex-col md:flex-row text-on-surface relative overflow-hidden font-sans">
      <aside className="w-full md:w-80 glass-panel border-r border-outline-variant flex flex-col z-20 shrink-0 h-full rounded-none">
        <div className="p-6 border-b border-outline-variant flex flex-col gap-1">
          <div className="flex items-center justify-between mb-2">
            <span className="px-2.5 py-0.5 rounded-lg bg-[#eff4ff] border border-[#d3e4fe] text-[#1960a3] text-[10px] font-extrabold uppercase tracking-wider">{getRoleLabel(role)} Mode</span>
            <span className="text-[10px] text-[#74777f] font-bold uppercase tracking-widest">Live Layer</span>
          </div>
          <h2 className="text-[20px] font-bold text-[#002045] tracking-tight flex items-center gap-2"><span className="material-symbols-outlined text-[#1960a3] text-[24px]">map</span> Map Explorer</h2>
          <p className="text-[#43474e] text-[13px] leading-relaxed">Real-time infrastructure monitoring with complaint heatmaps and severity analysis</p>
        </div>
        <div className="p-4 border-b border-outline-variant"><div className="relative"><span className="material-symbols-outlined absolute left-3 top-1/2 transform -translate-y-1/2 text-on-surface-variant text-[18px]">search</span><input type="text" placeholder="Search roads, areas, or complaint types..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border border-outline-variant rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent bg-white" /></div></div>
        <div className="p-6 flex flex-col gap-6 flex-grow overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl border border-outline-variant bg-surface-container-low">
                <div className="text-[11px] uppercase tracking-widest text-on-surface-variant font-bold">Mode</div>
              <div className="mt-1 text-[14px] font-bold text-primary">{mapModeLabel}</div>
            </div>
            <div className="p-3 rounded-xl border border-outline-variant bg-surface-container-low">
              <div className="text-[11px] uppercase tracking-widest text-on-surface-variant font-bold">Regions</div>
              <div className="mt-1 text-[14px] font-bold text-primary">{regionSummaries.length}</div>
            </div>
              <div className="p-3 rounded-xl border border-outline-variant glass-panel">
              <div className="text-[11px] uppercase tracking-widest text-on-surface-variant font-bold">Heat nodes</div>
              <div className="mt-1 text-[14px] font-bold text-primary">{heatmapData.length || complaints.length}</div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-1.5"><span className="material-symbols-outlined text-[16px]">layers</span> Active Layers</h3>
            <div className="flex flex-col gap-2">
              <label className="flex items-center justify-between p-3.5 bg-white border border-outline-variant rounded-xl cursor-pointer hover:border-secondary transition-all shadow-sm"><div className="flex items-center gap-3"><span className="w-2.5 h-2.5 rounded-full bg-error"/><span className="text-[14px] font-medium text-on-surface">Road Structural</span></div><input type="checkbox" checked={layers.structural} onChange={(e) => setLayers({ ...layers, structural: e.target.checked })} className="rounded border-outline-variant text-secondary focus:ring-secondary h-4.5 w-4.5 cursor-pointer" /></label>
              <label className="flex items-center justify-between p-3.5 bg-white border border-outline-variant rounded-xl cursor-pointer hover:border-secondary transition-all shadow-sm"><div className="flex items-center gap-3"><span className="w-2.5 h-2.5 rounded-full bg-amber-400"/><span className="text-[14px] font-medium text-on-surface">Lighting Grid</span></div><input type="checkbox" checked={layers.lighting} onChange={(e) => setLayers({ ...layers, lighting: e.target.checked })} className="rounded border-outline-variant text-secondary focus:ring-secondary h-4.5 w-4.5 cursor-pointer" /></label>
                <label className="flex items-center justify-between p-3.5 glass-panel border border-outline-variant rounded-xl cursor-pointer hover:border-secondary transition-all shadow-sm"><div className="flex items-center gap-3"><span className="w-2.5 h-2.5 rounded-full bg-[color:var(--on-tertiary-container)]"/><span className="text-[14px] font-medium text-on-surface">Drainage Systems</span></div><input type="checkbox" checked={layers.drainage} onChange={(e) => setLayers({ ...layers, drainage: e.target.checked })} className="rounded border-outline-variant text-secondary focus:ring-secondary h-4.5 w-4.5 cursor-pointer" /></label>
              <label className="flex items-center justify-between p-3.5 bg-white border border-outline-variant rounded-xl cursor-pointer hover:border-secondary transition-all shadow-sm"><div className="flex items-center gap-3"><span className="w-2.5 h-2.5 rounded-full bg-outline-variant"/><span className="text-[14px] font-medium text-on-surface">Resolved Layer</span></div><input type="checkbox" checked={layers.resolved} onChange={(e) => setLayers({ ...layers, resolved: e.target.checked })} className="rounded border-outline-variant text-secondary focus:ring-secondary h-4.5 w-4.5 cursor-pointer" /></label>
            </div>
          </div>
          <div className="flex flex-col gap-3"><h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-1.5"><span className="material-symbols-outlined text-[16px]">sliders</span> Tracked Segments</h3><div className="flex flex-col gap-2">{roads.map(r => (<div key={r.id} onClick={() => navigate(`/road/${r.id}`)} className="p-3.5 rounded-xl border border-outline-variant bg-white hover:bg-surface-container-low cursor-pointer flex justify-between items-center group transition-all"><div><span className="text-[14px] font-bold text-on-surface group-hover:text-secondary transition-colors">{r.name}</span><span className="text-[11px] text-on-surface-variant block mt-0.5">{r.km}</span></div><span className="material-symbols-outlined text-on-surface-variant group-hover:text-secondary group-hover:translate-x-0.5 transition-all text-[18px]">arrow_forward</span></div>))}</div></div>

          <div className="flex flex-col gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">area_chart</span> Regional performance
            </h3>
            <div className="flex flex-col gap-2">
              {regionSummaries.map((region) => (
                <div key={region.name} className="p-3.5 rounded-xl border border-outline-variant bg-white flex flex-col gap-2">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-[14px] font-bold text-on-surface">{region.name}</span>
                    <span className="text-[11px] text-on-surface-variant">{region.count} complaints</span>
                  </div>
                  <div className="flex gap-2 text-[11px] text-on-surface-variant flex-wrap">
                    <span className="px-2 py-0.5 rounded-full bg-surface-container-low border border-outline-variant">{region.severe} severe</span>
                    <span className="px-2 py-0.5 rounded-full bg-surface-container-low border border-outline-variant">{region.resolved} resolved</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
      <main className="flex-1 relative">
        {loading ? (<div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10"><div className="text-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-secondary mx-auto mb-4" /><p className="text-on-surface-variant">Loading complaint data...</p></div></div>) : null}
        <ComplaintHeatmap
          complaints={complaints}
          heatmapAggregates={heatmapData}
          center={mapCenter}
          zoom={selectedRoad ? 14 : 11}
          height="100%"
          showControls
          showLegend
          legendPosition="bottom-right"
          heatmapThreshold={16}
          cityZoomThreshold={11}
          onComplaintClick={handleComplaintClick}
        />
        <div className="absolute bottom-6 left-6 flex gap-3 z-20"><button onClick={() => navigate('/complaints/new')} className="px-4 py-2 bg-secondary hover:bg-primary text-white rounded-lg shadow-lg transition-colors text-sm font-medium flex items-center gap-2"><span className="material-symbols-outlined text-[18px]">add</span>Report Issue</button><button onClick={() => { void resolveMapCenter().then(setMapCenter) }} className="px-4 py-2 bg-white hover:bg-surface-container-low text-on-surface-variant rounded-lg shadow-lg transition-colors text-sm font-medium flex items-center gap-2 border border-outline-variant"><span className="material-symbols-outlined text-[18px]">my_location</span>My location</button></div>
      </main>
    </div>
  )
}
