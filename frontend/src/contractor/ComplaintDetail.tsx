import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Card, CardBody, Container, Hero } from '../components/UIComponents'
import { getRecord } from '../lib/offlineStore'

const statusProgress: Record<string, number> = {
  Submitted: 25,
  Anchored: 50,
  'In Progress': 75,
  Resolved: 100,
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'Submitted':
      return 'Submitted'
    case 'Anchored':
      return 'Anchored'
    case 'In Progress':
      return 'In Progress'
    case 'Resolved':
      return 'Resolved'
    case 'Escalated':
      return 'Escalated'
    default:
      return status
  }
}

export default function ContractorComplaintDetail(){
  const { id } = useParams()
  const navigate = useNavigate()
  const [c, setC] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRecord('complaints', String(id)).then((found) => setC(found || null)).finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="stitch-display-flex stitch-items-center stitch-minh-300" style={{ justifyContent: 'center' }}>
      <Spinner />
    </div>
  )

  if (!c) return (
    <Container>
      <Card>
        <CardBody>
          <div className="stitch-center-text p-lg">
            <h3 className="stitch-font-20 stitch-text-error" style={{ marginBottom: 8 }}>Complaint not found</h3>
            <p className="stitch-text-muted">The complaint you're looking for doesn't exist.</p>
            <div className="stitch-mt-16">
              <Button onClick={() => navigate('/dashboard/contractor')} variant="primary">Back to dashboard</Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </Container>
  )

  function normalizeStatusDisplay(c:any) {
    if (c?.anchored_at || c?.anchored_tx_hash || c?.fabric_txid) return 'Anchored'
    const s = String(c?.status || '').toUpperCase()
    if (s === 'FILED' || s === 'PENDING' || s === 'SUBMITTED') return 'Submitted'
    if (s === 'IN_PROGRESS' || s === 'IN PROGRESS') return 'In Progress'
    if (s === 'RESOLVED') return 'Resolved'
    return c?.status || 'Submitted'
  }

  const displayStatus = normalizeStatusDisplay(c)
  const progress = statusProgress[displayStatus] || 0
  const severityTone = c.severity <= 2 ? 'success' : c.severity <= 3 ? 'warning' : 'error'

  return (
    <Container>
      <Hero title={`${getStatusIcon(displayStatus)} Complaint ${c.id}`} subtitle={`Road: ${c.roadId} • Authority: ${c.routedTo}`} />

      <section className="stitch-mt-12">
        <div className="stitch-grid-auto-fit-220">
          {[
            ['Road', c.roadId],
            ['Damage type', c.damageType],
            ['Severity', `${c.severity}/5`],
            ['Status', displayStatus],
          ].map(([label, value]) => (
            <Card key={String(label)}>
              <CardBody>
                <div className="stitch-text-12 stitch-text-muted">{label}</div>
                <div className="stitch-mt-8 stitch-font-18 stitch-font-700">{value}</div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section className="stitch-mt-12">
        <Card>
          <CardBody>
            <h3 className="stitch-font-18 stitch-font-700">Status progress</h3>
            <div className="stitch-mt-12">
              <div style={{ height: 12, borderRadius: 9999, background: 'var(--color-muted)' }}>
                <div style={{ height: '100%', borderRadius: 9999, background: 'var(--color-primary)', width: `${progress}%` }} />
              </div>
            </div>
          </CardBody>
        </Card>
      </section>

      {c.media && c.media.length > 0 && (
        <section className="stitch-mt-12">
          <Card>
            <CardBody>
              <h3 className="stitch-font-18 stitch-font-700">Media evidence</h3>
              <div className="stitch-mt-12 stitch-grid-auto-fit-220">
                {c.media.map((media:any) => (
                  <Card key={media.id}>
                    <CardBody>
                      {media.type === 'photo' && media.dataUrl && <img src={media.dataUrl} alt="Evidence" className="stitch-img-cover" />}
                      {media.type === 'video' && media.dataUrl && <video src={media.dataUrl} className="stitch-img-cover" controls />}
                      <div style={{ paddingTop: 8 }}>
                        <div className="stitch-font-700" style={{ fontSize: 13 }}>{media.type === 'photo' ? 'Photo' : 'Video'}</div>
                        <div style={{ marginTop: 8 }}><Badge tone={media.status === 'Verified' ? 'success' : 'warning'}>{media.status}</Badge></div>
                        <div style={{ marginTop: 8 }} className="stitch-text-12 stitch-text-muted">{new Date(media.timestamp).toLocaleDateString()}</div>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </CardBody>
          </Card>
        </section>
      )}

      <section className="stitch-mt-12">
        <Card>
          <CardBody>
            <div className="stitch-display-flex stitch-items-center stitch-justify-between">
              <div>
                <h3 className="stitch-font-18 stitch-font-700">Actions</h3>
                <p className="stitch-mt-6 stitch-text-muted">Contractor view is read-only for complaint status.</p>
              </div>
              <div className="stitch-display-flex stitch-gap-8">
                <Button onClick={() => navigate(-1)} variant="primary">Back</Button>
                <Button onClick={() => alert('Contacting authority...')} variant="ghost">Contact authority</Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </section>
    </Container>
  )
}
