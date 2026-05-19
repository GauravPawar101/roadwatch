import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { authorityProfiles } from '../data/roadwatchDashboard'
import { enqueueAction, getRecord, saveRecord } from '../lib/offlineStore'

const inspectors = authorityProfiles.map((authority, index) => ({
  id: `ins_${index + 1}`,
  name: authority.name,
  role: authority.role,
  scope: authority.scope,
  load: [3, 1, 0][index] ?? 2,
  efficiency: authority.efficiencyScore,
}))

export default function AssignInspector(){
  const { id } = useParams()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [complaint, setComplaint] = useState<any | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(true)

  useEffect(()=>{
    if (inspectors.length) setSelected(inspectors[0].id)
    getRecord('complaints', String(id)).then((found) => setComplaint(found || null))
  }, [id])

  async function confirm(){
    if (!selected || !complaint) return
    setLoading(true)
    try {
      const updated = { ...complaint, assignedInspector: selected, status: 'Assigned' }
      await saveRecord('complaints', String(id), updated)
      await enqueueAction('authority.inspector.assign', { complaintId: id, inspectorId: selected, dueDate, notes })
      
      const token = localStorage.getItem('roadwatch_token')
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100'
      if (token) {
        fetch(`${apiBase}/authority/complaints/${id}/assign`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ inspectorId: selected }),
        }).catch(() => undefined)
      }
      
      navigate(`/authority/complaint/${id}`)
    } finally {
      setLoading(false)
    }
  }

  if (!complaint) return (
    <div className="stitch-minh-100vh stitch-display-grid stitch-place-items-center" style={{ background: '#020817', color: '#cbd5e1' }}>
      Loading complaint...
    </div>
  )

  return (
    <div className="page-radial-bg" style={{ minHeight: '100vh', color: '#dbeafe' }}>
      <div className="container-max">
        <section className="glass-panel rounded-2xl p-lg shadow-lg">
          <div className="muted-upper">Assign inspector</div>
          <h1 className="headline-lg" style={{ marginTop: 12 }}>Complaint {id}</h1>
          <p className="body-md" style={{ marginTop: 14 }}>Select the authority reviewer with the right scope, load, and efficiency score before committing the assignment.</p>
        </section>

        <section className="grid-two-col stitch-mt-20">
          <div className="glass-panel rounded-xl p-lg shadow-lg">
            <div className="stitch-display-flex stitch-justify-between stitch-gap-12 stitch-flex-wrap">
              <div>
                <div className="muted-upper">Inspector pool</div>
                <h2 className="stitch-mt-10 stitch-font-24 stitch-font-800 stitch-text-white-80">Authority reviewers</h2>
              </div>
              <button onClick={() => navigate(-1)} className="btn-ghost">Cancel</button>
            </div>

            <div className="stitch-display-grid stitch-gap-14 stitch-mt-16">
              {inspectors.map((inspector) => {
                const isSelected = selected === inspector.id
                return (
                  <button
                    key={inspector.id}
                    onClick={() => setSelected(inspector.id)}
                    className={`inspector-btn ${isSelected ? 'selected' : ''}`}
                  >
                    <div className="stitch-display-flex stitch-gap-14 stitch-items-start">
                      <div className="stitch-mt-4">
                        <input type="radio" name="inspector" checked={isSelected} onChange={() => setSelected(inspector.id)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="stitch-display-flex stitch-justify-between stitch-gap-16 stitch-flex-wrap">
                          <div>
                            <div className="stitch-font-18 stitch-font-800 stitch-text-white-80">{inspector.name}</div>
                            <div className="stitch-mt-6 stitch-text-secondary">{inspector.role}</div>
                          </div>
                          <div className="stitch-text-12 stitch-text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.12em' }}>Load {inspector.load}</div>
                        </div>
                        <div className="stitch-mt-12 stitch-display-flex stitch-flex-wrap stitch-gap-8">
                          <span className="chip">{inspector.scope}</span>
                          <span className="chip">Efficiency {inspector.efficiency}%</span>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <aside className="stitch-display-grid stitch-gap-20">
            <section className="glass-panel rounded-xl p-lg shadow-lg">
              <div className="muted-upper">Case snapshot</div>
              <div style={{ marginTop: 12, color: '#f8fafc', fontSize: 24, fontWeight: 800 }}>{complaint.title || complaint.damageType}</div>
              <div style={{ marginTop: 8, color: '#cbd5e1', lineHeight: 1.7 }}>{complaint.roadId} · {complaint.district || complaint.routedTo || 'Authority queue'}</div>
              <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
                <div style={{ color: '#cbd5e1' }}><strong style={{ color: '#f8fafc' }}>Severity:</strong> {complaint.severity}/5</div>
                <div style={{ color: '#cbd5e1' }}><strong style={{ color: '#f8fafc' }}>Status:</strong> {complaint.status}</div>
              </div>
            </section>

            <section className="glass-panel rounded-xl p-lg shadow-lg">
              <div className="stitch-display-flex stitch-justify-between stitch-gap-12 stitch-items-center">
                <div>
                  <div className="muted-upper">Inspector profile drawer</div>
                  <h3 className="stitch-mt-10 stitch-font-24 stitch-font-800 stitch-text-white-80">Work history preview</h3>
                </div>
                <button onClick={() => setDrawerOpen((value) => !value)} className="btn-ghost">{drawerOpen ? 'Hide' : 'Show'}</button>
              </div>
              {drawerOpen && selected && (
                <div className="stitch-mt-16" style={{ borderRadius: 22, padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="stitch-text-white-80 stitch-font-800">{inspectors.find((inspector) => inspector.id === selected)?.name}</div>
                  <div className="stitch-mt-6 stitch-text-secondary">{inspectors.find((inspector) => inspector.id === selected)?.role}</div>
                  <div className="stitch-mt-12 stitch-display-grid stitch-gap-8 stitch-text-secondary" style={{ fontSize: 14 }}>
                    <div><strong className="stitch-text-white-80">Scope:</strong> {inspectors.find((inspector) => inspector.id === selected)?.scope}</div>
                    <div><strong className="stitch-text-white-80">Efficiency:</strong> {inspectors.find((inspector) => inspector.id === selected)?.efficiency}%</div>
                    <div><strong className="stitch-text-white-80">Current load:</strong> {inspectors.find((inspector) => inspector.id === selected)?.load} cases</div>
                  </div>
                  <div className="stitch-mt-14 stitch-display-grid stitch-gap-8">
                    <div className="muted-upper">Work history</div>
                    <div className="stitch-text-secondary">Relevant assignment history and workload are shown here for authority review before allocation.</div>
                  </div>
                </div>
              )}
            </section>

            <section className="glass-panel rounded-xl p-lg shadow-lg">
              <div className="muted-upper">Assignment controls</div>
              <h3 style={{ marginTop: 10, color: '#f8fafc', fontSize: 24, fontWeight: 800 }}>Commit selection</h3>
              <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                <label style={{ display: 'grid', gap: 8, color: '#cbd5e1', fontSize: 14 }}>
                  Due date
                  <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="form-input" />
                </label>
                <label style={{ display: 'grid', gap: 8, color: '#cbd5e1', fontSize: 14 }}>
                  Notes
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional assignment notes" className="form-textarea" />
                </label>
              </div>
              <button
                onClick={confirm}
                disabled={loading}
                className="btn-muted-gradient"
                style={loading ? { background: 'rgba(148,163,184,0.35)', cursor: 'not-allowed' } : undefined}
              >
                {loading ? 'Assigning...' : 'Confirm assignment'}
              </button>
            </section>
          </aside>
        </section>
      </div>
    </div>
  )
}
