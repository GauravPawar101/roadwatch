import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { authorityProfiles, timelineEvents } from '../data/roadwatchDashboard'
import { enqueueAction, getRecord, saveRecord } from '../lib/offlineStore'

const statusProgress: Record<string, number> = {
  Submitted: 25,
  Anchored: 50,
  'In Progress': 75,
  Resolved: 100,
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'Submitted':
      return '📋'
    case 'Anchored':
      return '⛓️'
    case 'In Progress':
      return '⚙️'
    case 'Resolved':
      return '✅'
    case 'Escalated':
      return '🚀'
    default:
      return '❓'
  }
}

export default function AuthorityComplaintDetail(){
  const { id } = useParams()
  const navigate = useNavigate()
  const [c, setC] = useState<any | null>(null)
  const [verification, setVerification] = useState<any | null>(null)
  const [upload, setUpload] = useState<any | null>(null)
  const [reviewComments, setReviewComments] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    Promise.all([
      getRecord('complaints', String(id)),
      getRecord('repair_verifications', String(id)),
      getRecord('complaint_uploads', String(id)),
    ]).then(([foundC, foundV, foundU]) => {
      setC(foundC || null)
      setVerification(foundV || null)
      setUpload(foundU || null)
    }).finally(() => setLoading(false))
  }, [id])

  async function pushStatusToBackend(status: string) {
    const token = localStorage.getItem('roadwatch_token')
    if (!token) return
    const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100'
    try {
      await fetch(`${apiBase}/authority/complaints/${id}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      })
    } catch (err) {
      // ignore network errors; action is queued locally
    }
  }

  function assign(){
    navigate(`/authority/assign/${id}`)
  }

  function updateStatus(s:string){
    if (!c) return
    if (s === 'Resolved' && !verification?.repaired) {
      alert('Cannot resolve complaint until issue is verified as repaired by AI/location checks.')
      return
    }
    const updated = { ...c, status: s }
    saveRecord('complaints', String(id), updated)
    enqueueAction('authority.status.update', { complaintId: id, status: s })
    pushStatusToBackend(s).catch(() => undefined)
    setC(updated)
    alert('Status updated')
  }

  function verifyRepair(approved: boolean) {
    if (!c) return
    const updatedVerification = {
      repaired: approved,
      aiScore: approved ? 0.96 : 0.22,
      comments: reviewComments.trim() || (approved ? 'Verified by authority review.' : 'Repair not yet acceptable.'),
      updatedAt: new Date().toISOString(),
    }
    setVerification(updatedVerification)
    saveRecord('repair_verifications', String(id), updatedVerification)
    enqueueAction('authority.repair.review', { complaintId: id, approved, comments: updatedVerification.comments })
  }

  const displayStatus = useMemo(() => {
    if (!c) return 'Submitted'
    if (c?.anchored_at || c?.anchored_tx_hash || c?.fabric_txid) return 'Anchored'
    const s = String(c?.status || '').toUpperCase()
    if (s === 'FILED' || s === 'PENDING' || s === 'SUBMITTED') return 'Submitted'
    if (s === 'IN_PROGRESS' || s === 'IN PROGRESS') return 'In Progress'
    if (s === 'RESOLVED') return 'Resolved'
    return c?.status || 'Submitted'
  }, [c])

  const progress = statusProgress[displayStatus] || 0
  const assignedAuthority = authorityProfiles[1] ?? authorityProfiles[0]
  const relatedEvents = timelineEvents.slice(0, 4)
  const relatedProject = {
    projectId: c?.complaintId || c?.id,
    name: c?.title || `Complaint ${c?.id}`,
    jurisdiction: c?.district || c?.routedTo || 'Authority queue',
    assignedTo: assignedAuthority.name,
    status: displayStatus === 'Resolved' ? 'Resolved' : displayStatus === 'In Progress' ? 'In Progress' : 'Assigned',
    slaTarget: 72,
    progressPct: progress,
    lastUpdated: c?.updatedAt || c?.createdAt,
  }

  const pageShell: React.CSSProperties = {
    minHeight: '100vh',
    background:
      'radial-gradient(circle at top right, rgba(76, 215, 246, 0.20), transparent 28%), radial-gradient(circle at top left, rgba(139, 92, 246, 0.24), transparent 30%), linear-gradient(180deg, #020817 0%, #07111f 48%, #020817 100%)',
    color: '#dbeafe',
  }

  const glass: React.CSSProperties = {
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(8, 16, 30, 0.72)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 24px 80px rgba(2, 6, 23, 0.42)',
  }

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    borderRadius: 9999,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.04)',
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  }

  const tone = c.severity <= 2 ? '#22c55e' : c.severity <= 3 ? '#f59e0b' : '#ef4444'

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#020817', color: '#cbd5e1' }}>
        Loading case details...
      </div>
    )
  }

  if (!c) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#020817', color: '#cbd5e1' }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc', textAlign: 'center' }}>Complaint not found</div>
        <div style={{ marginTop: 8, textAlign: 'center' }}>The complaint you’re looking for doesn’t exist.</div>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
          <button onClick={() => navigate('/dashboard/authority')} style={{ border: 'none', borderRadius: 14, padding: '12px 16px', fontWeight: 800, color: '#08111f', background: 'linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%)', cursor: 'pointer' }}>
            Back to dashboard
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="page-radial-bg" style={{ minHeight: '100vh', color: '#dbeafe' }}>
      <div className="container-max">
        <section className="glass-panel rounded-2xl p-lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 880 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Complaint detail</div>
              <h1 style={{ margin: '12px 0 0', fontSize: 'clamp(2.2rem, 4vw, 4rem)', lineHeight: 1.05, letterSpacing: '-0.04em', fontWeight: 900, color: '#f8fafc' }}>
                {getStatusIcon(displayStatus)} {c.title || `Complaint ${c.id}`}
              </h1>
              <p style={{ margin: '14px 0 0', color: '#cbd5e1', fontSize: 16, lineHeight: 1.7 }}>
                {c.damageType} · {c.roadId} · routed to {c.routedTo || 'authority queue'} · {displayStatus}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
                <span style={{ ...chipStyle, borderColor: 'rgba(255,255,255,0.14)' }}>Complaint ID {c.id}</span>
                <span style={{ ...chipStyle, color: tone, borderColor: 'rgba(255,255,255,0.14)' }}>Severity {c.severity}/5</span>
                <span style={{ ...chipStyle, borderColor: 'rgba(255,255,255,0.14)' }}>SLA {new Date(c.slaDeadline).toLocaleDateString()}</span>
                <span style={{ ...chipStyle, borderColor: 'rgba(255,255,255,0.14)' }}>{verification?.repaired ? 'Verified repair' : 'Awaiting repair verification'}</span>
              </div>
            </div>

            <div style={{ minWidth: 280, flex: '0 1 320px', ...glass, borderRadius: 28, padding: 20 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Quick actions</div>
              <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
                <button onClick={assign} style={{ border: 'none', borderRadius: 16, padding: '12px 16px', fontWeight: 800, color: '#08111f', background: 'linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%)', cursor: 'pointer' }}>Assign inspector</button>
                <button onClick={() => navigate(`/authority/repair/${c.id}`)} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '12px 16px', fontWeight: 800, color: '#e2e8f0', background: 'rgba(255,255,255,0.04)', cursor: 'pointer' }}>Verify repair</button>
                <button onClick={() => navigate('/dashboard/authority')} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '12px 16px', fontWeight: 800, color: '#e2e8f0', background: 'rgba(255,255,255,0.04)', cursor: 'pointer' }}>Back to dashboard</button>
              </div>
            </div>
          </div>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1.35fr 0.95fr', gap: 20, marginTop: 20 }}>
          <div style={{ display: 'grid', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
              {[
                { label: 'Road', value: c.roadId },
                { label: 'Damage type', value: c.damageType },
                { label: 'Severity', value: `${c.severity}/5`, tone },
                { label: 'Status', value: displayStatus },
              ].map((item) => (
                <div key={item.label} style={{ ...glass, borderRadius: 24, padding: 18 }}>
                  <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>{item.label}</div>
                  <div style={{ marginTop: 10, fontSize: 20, fontWeight: 800, color: item.tone || '#f8fafc' }}>{item.value}</div>
                </div>
              ))}
            </div>

            <section style={{ ...glass, borderRadius: 28, padding: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Case summary</div>
                  <h2 style={{ margin: '10px 0 0', color: '#f8fafc', fontSize: 24, fontWeight: 800 }}>Governance actions and route details</h2>
                </div>
                <button
                  onClick={() => window.open(`https://explorer.example.com/tx/${c.txId || ''}`, '_blank')}
                  style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: '10px 14px', fontWeight: 800, color: '#e2e8f0', background: 'rgba(255,255,255,0.04)', cursor: 'pointer' }}
                >
                  View on blockchain
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, marginTop: 16 }}>
                <div style={{ borderRadius: 22, padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Submitted</div>
                  <div style={{ marginTop: 8, color: '#f8fafc', fontWeight: 800 }}>{new Date(c.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ borderRadius: 22, padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Location</div>
                  <div style={{ marginTop: 8, color: '#f8fafc', fontWeight: 800 }}>({c.location?.lat?.toFixed?.(4)}, {c.location?.lng?.toFixed?.(4)})</div>
                </div>
                <div style={{ borderRadius: 22, padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Authority</div>
                  <div style={{ marginTop: 8, color: '#f8fafc', fontWeight: 800 }}>{assignedAuthority.name}</div>
                  <div style={{ marginTop: 6, color: '#cbd5e1', fontSize: 14 }}>{assignedAuthority.role}</div>
                </div>
                <div style={{ borderRadius: 22, padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>SLA deadline</div>
                  <div style={{ marginTop: 8, color: '#f8fafc', fontWeight: 800 }}>{new Date(c.slaDeadline).toLocaleString()}</div>
                </div>
              </div>

              {c.notes && (
                <div style={{ marginTop: 16, borderRadius: 22, padding: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Notes</div>
                  <p style={{ margin: '10px 0 0', color: '#e2e8f0', lineHeight: 1.7 }}>{c.notes}</p>
                </div>
              )}
            </section>

            <section style={{ ...glass, borderRadius: 28, padding: 22 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Related project</div>
              <h3 style={{ margin: '10px 0 0', color: '#f8fafc', fontSize: 24, fontWeight: 800 }}>Linked assignment</h3>
              <div style={{ marginTop: 16, borderRadius: 22, padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ color: '#f8fafc', fontWeight: 800 }}>{relatedProject.name}</div>
                    <div style={{ marginTop: 6, color: '#cbd5e1' }}>{relatedProject.jurisdiction}</div>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{relatedProject.status}</div>
                </div>
                <div style={{ marginTop: 12, height: 8, borderRadius: 9999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{ width: `${relatedProject.progressPct}%`, height: '100%', background: 'linear-gradient(90deg, #8b5cf6 0%, #06b6d4 100%)' }} />
                </div>
                <div style={{ marginTop: 12, display: 'grid', gap: 8, color: '#cbd5e1', fontSize: 14 }}>
                  <div><strong style={{ color: '#f8fafc' }}>Project ID:</strong> {relatedProject.projectId}</div>
                  <div><strong style={{ color: '#f8fafc' }}>Assigned to:</strong> {relatedProject.assignedTo}</div>
                  <div><strong style={{ color: '#f8fafc' }}>SLA target:</strong> {relatedProject.slaTarget}h</div>
                  <div><strong style={{ color: '#f8fafc' }}>Last updated:</strong> {relatedProject.lastUpdated}</div>
                </div>
              </div>
            </section>

            <section style={{ ...glass, borderRadius: 28, padding: 22 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Person contact</div>
              <h3 style={{ margin: '10px 0 0', color: '#f8fafc', fontSize: 24, fontWeight: 800 }}>Assigned authority</h3>
              <div style={{ marginTop: 16, borderRadius: 22, padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ color: '#f8fafc', fontWeight: 800 }}>{assignedAuthority.name}</div>
                <div style={{ marginTop: 6, color: '#cbd5e1' }}>{assignedAuthority.role}</div>
                <div style={{ marginTop: 12, display: 'grid', gap: 6, color: '#cbd5e1', fontSize: 14 }}>
                  <div><strong style={{ color: '#f8fafc' }}>Scope:</strong> {assignedAuthority.scope}</div>
                  <div><strong style={{ color: '#f8fafc' }}>Level:</strong> {assignedAuthority.level}</div>
                </div>
              </div>
            </section>

            {upload?.ipfs && (
              <section style={{ ...glass, borderRadius: 28, padding: 22 }}>
                <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Citizen upload</div>
                <h3 style={{ margin: '10px 0 0', color: '#f8fafc', fontSize: 24, fontWeight: 800 }}>Evidence package</h3>
                <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
                  <div style={{ borderRadius: 18, padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}><strong>CID:</strong> {upload.ipfs}</div>
                  <div style={{ borderRadius: 18, padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}><strong>Upload ID:</strong> {upload.uploadId || 'n/a'}</div>
                  <div style={{ borderRadius: 18, padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}><strong>SHA-256:</strong> {upload.sha || 'n/a'}</div>
                </div>
              </section>
            )}

            {c.media && c.media.length > 0 && (
              <section style={{ ...glass, borderRadius: 28, padding: 22 }}>
                <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Media evidence</div>
                <h3 style={{ margin: '10px 0 0', color: '#f8fafc', fontSize: 24, fontWeight: 800 }}>Source material</h3>
                <div style={{ marginTop: 16, display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                  {c.media.map((media: any) => (
                    <article key={media.id} style={{ borderRadius: 20, overflow: 'hidden', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      {media.type === 'photo' && media.dataUrl && <img src={media.dataUrl} alt="Evidence" style={{ width: '100%', height: 220, objectFit: 'cover' }} />}
                      {media.type === 'video' && media.dataUrl && <video src={media.dataUrl} controls style={{ width: '100%', height: 220, objectFit: 'cover' }} />}
                      <div style={{ padding: 14 }}>
                        <div style={{ color: '#f8fafc', fontWeight: 800 }}>{media.type === 'photo' ? 'Photo' : 'Video'}</div>
                        <div style={{ marginTop: 8, color: '#cbd5e1', fontSize: 13 }}>{media.status}</div>
                        <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>{new Date(media.timestamp).toLocaleDateString()}</div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside style={{ display: 'grid', gap: 20 }}>
            <section style={{ ...glass, borderRadius: 28, padding: 22 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Status progress</div>
              <h3 style={{ margin: '10px 0 0', color: '#f8fafc', fontSize: 24, fontWeight: 800 }}>Workflow stage</h3>
              <div style={{ marginTop: 18 }}>
                <div style={{ height: 8, borderRadius: 9999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg, #8b5cf6 0%, #06b6d4 100%)' }} />
                </div>
                <div style={{ marginTop: 12, color: '#cbd5e1', fontSize: 13 }}>{Math.round(progress)}% complete</div>
              </div>
            </section>

            <section style={{ ...glass, borderRadius: 28, padding: 22 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Governance actions</div>
              <h3 style={{ margin: '10px 0 0', color: '#f8fafc', fontSize: 24, fontWeight: 800 }}>Update this case</h3>
              <div style={{ marginTop: 14 }}>
                <textarea
                  value={reviewComments}
                  onChange={(event) => setReviewComments(event.target.value)}
                  placeholder="Optional authority comments"
                  style={{ width: '100%', minHeight: 92, borderRadius: 16, padding: 14, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
                <button onClick={() => updateStatus('Acknowledged')} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '12px 16px', fontWeight: 800, color: '#e2e8f0', background: 'rgba(255,255,255,0.04)', cursor: 'pointer' }}>Acknowledge</button>
                <button onClick={() => updateStatus('Assigned')} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '12px 16px', fontWeight: 800, color: '#e2e8f0', background: 'rgba(255,255,255,0.04)', cursor: 'pointer' }}>Mark assigned</button>
                <button onClick={() => updateStatus('In Progress')} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '12px 16px', fontWeight: 800, color: '#e2e8f0', background: 'rgba(255,255,255,0.04)', cursor: 'pointer' }}>Mark in progress</button>
                <button onClick={() => verifyRepair(true)} style={{ border: 'none', borderRadius: 16, padding: '12px 16px', fontWeight: 800, color: '#08111f', background: 'linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%)', cursor: 'pointer' }}>Verify repair</button>
                <button onClick={() => verifyRepair(false)} style={{ border: '1px solid rgba(248,113,113,0.35)', borderRadius: 16, padding: '12px 16px', fontWeight: 800, color: '#fecaca', background: 'rgba(248,113,113,0.08)', cursor: 'pointer' }}>Reject repair</button>
                <button onClick={() => updateStatus('Resolved')} disabled={!verification?.repaired} style={{ border: 'none', borderRadius: 16, padding: '12px 16px', fontWeight: 800, color: '#08111f', background: verification?.repaired ? 'linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%)' : 'rgba(148,163,184,0.3)', cursor: verification?.repaired ? 'pointer' : 'not-allowed' }}>Resolve case</button>
              </div>
              <p style={{ marginTop: 14, color: verification?.repaired ? '#86efac' : '#fca5a5', lineHeight: 1.6 }}>
                Repair verification: {verification?.repaired ? `Verified (score ${Number(verification.aiScore || 0).toFixed(2)})` : 'Not verified'}
              </p>
              {verification?.comments && <p style={{ marginTop: 8, color: '#cbd5e1', lineHeight: 1.6 }}>{verification.comments}</p>}
            </section>

            <section style={{ ...glass, borderRadius: 28, padding: 22 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Audit log</div>
              <h3 style={{ margin: '10px 0 0', color: '#f8fafc', fontSize: 24, fontWeight: 800 }}>Timeline</h3>
              <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
                {relatedEvents.map((event) => (
                  <div key={event.id} style={{ borderRadius: 18, padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ color: '#f8fafc', fontWeight: 800 }}>{event.title}</div>
                      <div style={{ color: '#94a3b8', fontSize: 12 }}>{event.time}</div>
                    </div>
                    <div style={{ marginTop: 8, color: '#cbd5e1', fontSize: 14, lineHeight: 1.6 }}>{event.description}</div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </div>
  )
}

