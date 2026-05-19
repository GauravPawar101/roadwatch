import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, StatCard } from '../components/UIComponents'

const seedProjects = [
  { id: 'p1', roadName: 'NH-48 Section 3', type: 'NH', start: '2024-04-01', end: '2027-03-31', phase: 'Under Construction', complaints: 4, condition: 71, authority: 'Local PWD' },
  { id: 'p2', roadName: 'SH-27 Bypass', type: 'SH', start: '2023-07-01', end: '2026-06-30', phase: 'Maintenance', complaints: 1, condition: 84, authority: 'District Engineer' },
  { id: 'p3', roadName: 'MDR-11 Link Road', type: 'MDR', start: '2022-12-15', end: '2025-12-14', phase: 'DLP', complaints: 2, condition: 63, authority: 'Rural Works Office' },
]

export default function ContractorDashboard(){
  const contractorId = localStorage.getItem('roadwatch_contractor_id') || 'SuperBuild Infra'
  const [projects, setProjects] = useState<any[]>([])

  useEffect(() => {
    setProjects(seedProjects)
  }, [])

  const summary = useMemo(() => ({
    total: projects.length,
    active: projects.filter((p) => p.phase !== 'DLP').length,
    dlp: projects.filter((p) => p.phase === 'DLP').length,
  }), [projects])

  const navigate = useNavigate()

  return (
    <div className="stitch-maxw-1100">
      <h2>Contractor Dashboard — {contractorId}</h2>
      <div className="stitch-display-flex stitch-gap-12 stitch-mt-12">
        <StatCard value={summary.total} label="Projects" />
        <StatCard value={summary.active} label="Active" />
        <StatCard value={summary.dlp} label="DLP" />
      </div>
      <div className="stitch-mt-20 stitch-display-grid stitch-gap-12">
        {projects.map((p) => (
          <div key={p.id} className="card stitch-display-flex stitch-justify-between stitch-items-center">
            <div>
              <div className="stitch-font-700">{p.roadName} <span className="stitch-text-muted">({p.type})</span></div>
              <div className="stitch-text-muted">Start: {p.start} • End: {p.end}</div>
              <div className="stitch-text-muted">Phase: {p.phase} • Active complaints: {p.complaints}</div>
            </div>
            <div className="stitch-display-flex stitch-gap-8">
              <Button variant="primary" onClick={() => navigate(`/contractor/project/${p.id}`)}>Open</Button>
              <Button variant="ghost" onClick={() => navigate(`/contractor/proof/${p.id}`)}>Upload Proof</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
