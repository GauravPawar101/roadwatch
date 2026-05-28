import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, StatCard } from '../components/UIComponents'
import { listRecords } from '../lib/offlineStore'

export default function AuthorityDashboard(){
  const authId = localStorage.getItem('roadwatch_authority_id') || 'Local PWD'
  const [complaints, setComplaints] = useState<any[]>([])
  useEffect(()=>{
    listRecords<any>('complaints').then((all) => {
      const mine = all.filter((c:any)=>c.routedTo===authId)
      setComplaints(mine)
    })
  }, [authId])

  const summary = useMemo(()=>({
    total: complaints.length,
    slaBreached: complaints.filter(c=> new Date(c.slaDeadline) < new Date()).length,
    resolvedThisWeek: complaints.filter(c=> c.status==='Resolved').length,
  }), [complaints])

  const navigate = useNavigate()

  return (
    <div className="stitch-maxw-1100">
      <h2>Authority Dashboard — {authId}</h2>
      <div className="stitch-display-flex stitch-gap-12 stitch-mt-12">
        <StatCard value={summary.total} label="Total Open" />
        <StatCard value={summary.slaBreached} label="SLA Breached" />
        <StatCard value={summary.resolvedThisWeek} label="Resolved This Week" />
      </div>

      <div className="stitch-mt-12">
        <Button onClick={() => navigate('/authority/performance')} variant="primary">Open Performance Evaluation</Button>
      </div>

      <div className="stitch-mt-18">
        <h3>Complaint Queue</h3>
        <div className="stitch-display-grid stitch-gap-10">
          {complaints.map(c=> (
            <div key={c.id} className="stitch-p-12 stitch-rounded-12 stitch-display-flex stitch-justify-between stitch-items-center" style={{ background: 'var(--card-bg)' }}>
              <div>
                <div className="stitch-font-700">{c.roadId} — {c.damageType}</div>
                <div style={{ color: 'var(--color-muted)' }}>Severity: {c.severity} • {Math.floor((Date.now()-new Date(c.createdAt).getTime())/3600000)}h ago</div>
              </div>
              <div className="stitch-display-flex stitch-gap-8">
                <Button onClick={() => navigate(`/authority/complaint/${c.id}`)} variant="primary">Open</Button>
                <Button variant="ghost">Bulk assign</Button>
              </div>
            </div>
          ))}
          {complaints.length===0 && <div style={{ color:'var(--color-muted)' }}>No complaints routed to your authority.</div>}
        </div>
      </div>
    </div>
  )
}
