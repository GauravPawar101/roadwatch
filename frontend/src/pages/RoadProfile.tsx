import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import MapEmbed from '../components/MapEmbed'
import { DELHI_CENTER } from '../lib/mapLocation'
import { Badge, Button, Card, CardBody, Hero, StatCard, StatsGrid } from '../components/UIComponents'
import { getActiveRole, getRoleLabel } from '../lib/session'

const roleCopy = {
  citizen: 'This road has regular monitoring. Tap report to submit a complaint with media capture.',
  authority: 'Authority view includes editable assignments, jurisdiction mapping, and priority controls.',
  contractor: 'Contractor view includes project condition, scope, and progress-proof uploads.',
} as const

type ConcernedAuthority = {
  authorityId?: string | null
  name?: string | null
  department?: string | null
  blockCode?: string | null
  org?: string | null
  publicPhone?: string | null
  publicEmail?: string | null
  website?: string | null
  address?: string | null
}

export default function RoadProfile() {
  const { id } = useParams()
  const role = getActiveRole()
  const [authority, setAuthority] = useState<ConcernedAuthority | null>(null)
  const [roadName, setRoadName] = useState(id === 'r1' ? 'NH-48: Pune–Mumbai' : `Road ${id ?? ''}`)
  const [kmLabel, setKmLabel] = useState('120 km')

  useEffect(() => {
    if (!id) return
    const base = (import.meta as any).env?.VITE_GATEWAY_URL || (import.meta as any).env?.VITE_API_URL || ''
    const url = `${String(base).replace(/\/$/, '')}/public/roads/${encodeURIComponent(id)}`
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.road) return
        if (data.road.name) setRoadName(data.road.name)
        if (data.road.totalLengthKm != null) setKmLabel(`${data.road.totalLengthKm} km`)
        if (data.road.concernedAuthority) setAuthority(data.road.concernedAuthority)
      })
      .catch(() => null)
  }, [id])

  const road = {
    id,
    name: roadName,
    km: kmLabel,
    status: 'Good',
    complaints: 12,
    resolved: 8,
    inProgress: 3,
    escalated: 1,
  }

  const stats = [
    { value: road.complaints, label: 'Total Reports', tone: 'text-slate-900' },
    { value: road.resolved, label: 'Resolved', tone: 'text-emerald-600' },
    { value: road.inProgress, label: 'In Progress', tone: 'text-amber-600' },
    { value: road.escalated, label: 'Escalated', tone: 'text-rose-600' },
  ]

  return (
    <div className="page-radial-bg min-h-screen text-on-surface py-12">
      <div className="container-max stitch-grid stitch-gap-24">
      <Hero
        title={road.name}
        subtitle={`${road.km} · Status: ${road.status}`}
        actions={<div className="stitch-display-flex stitch-gap-8"><Badge>{getRoleLabel(role)}</Badge></div>}
      />

      <StatsGrid>
        {stats.map((stat) => (
          <StatCard key={stat.label} value={stat.value} label={stat.label} className="" />
        ))}
      </StatsGrid>

      <div className="stitch-grid stitch-gap-16" style={{ gridTemplateColumns: '1fr 360px' }}>
        <Card>
          <CardBody>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Road information</div>
            <div className="stitch-grid stitch-gap-12" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 12 }}>
              <Card>
                <CardBody>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Road ID</div>
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700 }}>{road.id}</div>
                </CardBody>
              </Card>

              <Card>
                <CardBody>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Length</div>
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700 }}>{road.km}</div>
                </CardBody>
              </Card>

              <Card>
                <CardBody>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Status</div>
                  <div style={{ marginTop: 6 }}><Badge variant="success">{road.status}</Badge></div>
                </CardBody>
              </Card>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Actions</div>
            <div style={{ marginTop: 8, color: 'var(--color-text-secondary)' }}>Role-specific tools keep the workflow tight and focused.</div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {role === 'citizen' && (
                <>
                  <Link to="/complaints"><Button variant="primary">Report an issue</Button></Link>
                  <Link to="/road/r1/history"><Button variant="ghost">View history</Button></Link>
                  <Link to="/road/r1/chat"><Button variant="ghost">Ask AI assistant</Button></Link>
                </>
              )}
              {role === 'authority' && (
                <>
                  <Button onClick={() => {}} variant="primary">Edit contractor mapping</Button>
                  <Button onClick={() => {}} variant="ghost">Flag priority maintenance</Button>
                  <Button onClick={() => {}} variant="ghost">Open admin layer</Button>
                </>
              )}
              {role === 'contractor' && (
                <>
                  <Link to={`/contractor/project/${id}`}><Button variant="primary">Open project</Button></Link>
                  <Link to={`/contractor/proof/${id}`}><Button variant="ghost">Upload proof</Button></Link>
                  <Link to={`/contractor/complaint/${id}`}><Button variant="ghost">My-road complaints</Button></Link>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Contact concerned authority</div>
          <div style={{ marginTop: 8, color: 'var(--color-text-secondary)' }}>
            Reach the office responsible for this road&apos;s block division.
          </div>
          <div className="stitch-grid stitch-gap-12" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Department / org</div>
              <div style={{ marginTop: 4, fontWeight: 700 }}>
                {authority?.department || authority?.org || authority?.name || 'Not mapped yet'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Block division</div>
              <div style={{ marginTop: 4, fontWeight: 700 }}>{authority?.blockCode || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Phone</div>
              <div style={{ marginTop: 4, fontWeight: 700 }}>
                {authority?.publicPhone ? (
                  <a href={`tel:${authority.publicPhone}`}>{authority.publicPhone}</a>
                ) : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Email</div>
              <div style={{ marginTop: 4, fontWeight: 700 }}>
                {authority?.publicEmail ? (
                  <a href={`mailto:${authority.publicEmail}`}>{authority.publicEmail}</a>
                ) : '—'}
              </div>
            </div>
            {authority?.website ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Website</div>
                <div style={{ marginTop: 4 }}>
                  <a href={authority.website} target="_blank" rel="noreferrer">{authority.website}</a>
                </div>
              </div>
            ) : null}
            {authority?.address ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Office address</div>
                <div style={{ marginTop: 4 }}>{authority.address}</div>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Location map</div>
            <div style={{ marginTop: 12 }}>
            <div className="stitch-rounded-12 stitch-overflow-hidden">
              <MapEmbed
                center={DELHI_CENTER}
                zoom={11}
                markers={[{ lat: DELHI_CENTER.lat, lng: DELHI_CENTER.lng, label: road.name }]}
                height="320px"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div style={{ color: 'var(--color-text-secondary)' }}>{roleCopy[role]}</div>
        </CardBody>
      </Card>
      </div>
    </div>
  )
}
