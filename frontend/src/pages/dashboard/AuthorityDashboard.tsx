import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'
import MapEmbed from '../../components/MapEmbed'
import { authorityProfiles, getAuthorityComplaintRows, getAuthorityProfileForLevel, insights, jurisdictionMap, roleActionLabels } from '../../data/roadwatchDashboard'

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  background:
    'radial-gradient(circle at top left, rgba(0,32,69,0.08), transparent 34%), radial-gradient(circle at top right, rgba(81,95,116,0.05), transparent 32%), linear-gradient(180deg, #faf9fc 0%, #f4f3f7 52%, #faf9fc 100%)',
  color: '#1a1b1e',
}

const panelStyle: React.CSSProperties = {
  border: '1px solid rgba(196,198,207,0.9)',
  background: 'rgba(255,255,255,0.96)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  boxShadow: '0 4px 18px rgba(0, 9, 27, 0.05)',
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderRadius: 9999,
  border: '1px solid rgba(196,198,207,0.9)',
  background: '#ffffff',
  color: '#44474e',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div style={{ ...panelStyle, borderRadius: 16, padding: 20 }}>
      <div style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>{label}</div>
      <div style={{ marginTop: 10, fontSize: 30, fontWeight: 800, color: '#1a1b1e' }}>{value}</div>
      <div style={{ marginTop: 8, color: '#44474e', fontSize: 14 }}>{detail}</div>
    </div>
  )
}

const hierarchyLevels = ['municipal', 'city-town-village', 'district', 'state'] as const

function sectionTitleStyle(): React.CSSProperties {
  return { color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }
}

const jurisdictionCoordinates: Record<string, { lat: number; lng: number }> = {
  'South Delhi': { lat: 28.5244, lng: 77.1855 },
  Mumbai: { lat: 19.076, lng: 72.8777 },
  Pune: { lat: 18.5204, lng: 73.8567 },
  Lucknow: { lat: 26.8467, lng: 80.9462 },
  'Bengaluru Urban': { lat: 12.9716, lng: 77.5946 },
  Chennai: { lat: 13.0827, lng: 80.2707 },
  'New Delhi': { lat: 28.6139, lng: 77.209 },
  Noida: { lat: 28.5355, lng: 77.391 },
}

export default function AuthorityDashboard() {
  const navigate = useNavigate()
  const [level, setLevel] = useState<(typeof hierarchyLevels)[number]>('district')
  const activeProfile = useMemo(() => getAuthorityProfileForLevel(level), [level])
  const authorityQueue = useMemo(() => getAuthorityComplaintRows(level), [level])

  const summary = useMemo(() => {
    const open = authorityQueue.filter((item) => item.status !== 'Resolved')
    const critical = authorityQueue.filter((item) => item.severity >= 8)
    const overloaded = authorityQueue.filter((item) => item.slaHoursLeft < 12)

    return {
      open: open.length,
      critical: critical.length,
      overload: overloaded.length,
      avgRisk: Math.round(authorityQueue.reduce((sum, item) => sum + item.fraudRisk, 0) / Math.max(1, authorityQueue.length)),
    }
  }, [authorityQueue])

  const topDistricts = jurisdictionMap.slice().sort((left, right) => right.risk - left.risk).slice(0, 4)
  const leadAuthority = activeProfile
  const juniorAuthorities = authorityProfiles.slice(0, 2)
  const contractorDirectory = [
    { companyName: 'SuperBuild Infra', contactName: 'Ravi Nair', status: 'Certified', specialization: 'Highway resurfacing', regions: ['South Delhi', 'New Delhi'] },
    { companyName: 'RoadForge Works', contactName: 'Meera Das', status: 'Pending renewal', specialization: 'Drainage repair', regions: ['Mumbai', 'Pune'] },
    { companyName: 'MetroRoads Ltd', contactName: 'Arun Iyer', status: 'Certified', specialization: 'Signal and signage', regions: ['Chennai', 'Bengaluru Urban'] },
  ]
  const projectPortfolio = authorityQueue.slice(0, 4).map((item, index) => ({
    id: `proj-${index + 1}`,
    projectId: item.complaintId,
    name: item.title,
    jurisdiction: item.district,
    assignedTo: index % 2 === 0 ? 'SuperBuild Infra' : 'RoadForge Works',
    complaintIds: [item.id],
    status: index === 0 ? 'Escalated' : index === 1 ? 'In Progress' : 'Assigned',
    slaTarget: 72,
    progressPct: 28 + index * 17,
    lastUpdated: item.updatedAt,
  }))

  const performanceSeries = useMemo(() => jurisdictionMap.slice(0, 6).map((item) => ({ name: item.name, trust: item.trust, risk: item.risk })), [])
  const topMarkers = topDistricts
    .map((district) => ({ name: district.name, coords: jurisdictionCoordinates[district.name] }))
    .filter((district) => Boolean(district.coords))

  return (
    <div className="page-radial-bg stitch-minh-100vh" style={shellStyle}>
      <div className="container-max">
        <header className="glass-panel rounded-2xl p-lg shadow-lg">
          <div className="stitch-display-flex stitch-justify-between stitch-gap-24 stitch-flex-wrap">
            <div className="" style={{ maxWidth: 760 }}>
              <div className="chip">Infrastructure Governance Portal</div>
              <h1 style={{ margin: '18px 0 0', fontSize: 'clamp(2.4rem, 4vw, 4.4rem)', lineHeight: 1, letterSpacing: '-0.04em', fontWeight: 900, color: '#1a1b1e' }}>
                Analytics & Strategic Oversight
              </h1>
              <p style={{ margin: '16px 0 0', maxWidth: 720, color: '#44474e', fontSize: 17, lineHeight: 1.7 }}>
                Jurisdiction control tower for assignment, verification, escalation, and reporting across municipal, district, and state levels.
              </p>
              <div className="stitch-mt-18" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 6, border: '1px solid rgba(196,198,207,0.9)', background: '#ffffff', padding: '8px 12px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#002045' }}>
                {activeProfile.scope} · {authorityQueue.length} assigned complaints
              </div>
              <div className="stitch-display-flex stitch-flex-wrap stitch-gap-10 stitch-mt-18">
                {roleActionLabels.authority.map((action) => (
                  <span key={action} className="chip">
                    {action}
                  </span>
                ))}
              </div>
              <div className="stitch-mt-18 stitch-display-flex stitch-flex-wrap stitch-gap-10">
                {hierarchyLevels.map((item) => (
                  <button
                    key={item}
                    onClick={() => setLevel(item)}
                    className={`inspector-btn ${item === level ? 'selected' : ''}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ minWidth: 280, flex: '0 1 320px' }} className="glass-panel rounded-2xl p-lg">
              <div style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Current lead</div>
              <div style={{ marginTop: 10, fontSize: 24, fontWeight: 800, color: '#1a1b1e' }}>{leadAuthority.name}</div>
              <div style={{ marginTop: 6, color: '#44474e' }}>{leadAuthority.role}</div>
              <div className="stitch-mt-16" style={{ display: 'grid', gap: 10 }}>
                <button onClick={() => navigate('/authority/analytics')} className="btn-primary">Open strategic analytics</button>
                <button onClick={() => navigate('/authority/report')} className="btn-ghost">Export district report</button>
              </div>
            </div>
          </div>
        </header>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginTop: 20 }}>
          <MetricCard label="Open cases" value={String(summary.open)} detail="Complaints currently routed to the authority queue." />
          <MetricCard label="Critical load" value={String(summary.critical)} detail="High severity issues needing active escalation." />
          <MetricCard label="SLA pressure" value={String(summary.overload)} detail="Cases with fewer than 12 hours remaining." />
          <MetricCard label="Fraud risk" value={`${summary.avgRisk}%`} detail="Average evidence and duplicate-cluster risk across the queue." />
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20, marginTop: 20 }}>
          <div style={{ display: 'grid', gap: 20 }}>
            <div style={{ ...panelStyle, borderRadius: 28, padding: 22 }}>
              <div style={sectionTitleStyle()}>Hierarchy switch</div>
              <h2 style={{ margin: '10px 0 0', fontSize: 24, fontWeight: 800, color: '#1a1b1e' }}>Jurisdiction scope</h2>
              <p style={{ margin: '10px 0 0', color: '#44474e', lineHeight: 1.7 }}>
                {activeProfile.scope}. {authorityQueue.length} complaints are currently visible for this jurisdiction and sorted by severity, SLA pressure, and recency.
              </p>
            </div>

            <div style={{ ...panelStyle, borderRadius: 28, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <div>
                <div style={sectionTitleStyle()}>Complaint queue</div>
                <h2 style={{ margin: '10px 0 0', fontSize: 28, lineHeight: 1.15, letterSpacing: '-0.03em', color: '#1a1b1e' }}>Jurisdiction workbench</h2>
              </div>
              <button
                onClick={() => navigate('/authority/road/ND-14A')}
                  style={{
                  border: '1px solid rgba(196,198,207,0.9)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontWeight: 800,
                  color: '#1a1b1e',
                  background: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                Open road profile
              </button>
            </div>

            <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
              {authorityQueue.map((item) => (
                <article key={item.id} style={{ ...panelStyle, borderRadius: 16, padding: 18, background: '#ffffff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#1a1b1e', fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>{item.title}</div>
                      <div style={{ marginTop: 6, color: '#44474e', fontSize: 14 }}>
                        {item.complaintId} · {item.roadId} · {item.district}
                      </div>
                      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <span style={chipStyle}>{item.category}</span>
                        <span style={chipStyle}>SLA {item.slaHoursLeft}h</span>
                        <span style={chipStyle}>Risk {item.fraudRisk}%</span>
                      </div>
                    </div>
                      <button
                      onClick={() => navigate(`/authority/complaint/${item.id}`)}
                      style={{
                        border: 'none',
                          borderRadius: 8,
                        padding: '10px 14px',
                        fontWeight: 800,
                          color: '#ffffff',
                          background: 'linear-gradient(135deg, #002045 0%, #515f74 100%)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Review case
                    </button>
                  </div>
                </article>
              ))}
            </div>
            </div>

            <div style={{ ...panelStyle, borderRadius: 28, padding: 22 }}>
              <div style={sectionTitleStyle()}>Jurisdiction map</div>
              <h2 style={{ margin: '10px 0 0', fontSize: 24, fontWeight: 800, color: '#1a1b1e' }}>Regional complaint concentration</h2>
              <p style={{ margin: '10px 0 0', color: '#44474e', lineHeight: 1.7 }}>
                Use the live map to inspect the highest-risk regions. The dashboard switches between pins and heat-style aggregation based on scope.
              </p>
              <div style={{ marginTop: 16, borderRadius: 20, overflow: 'hidden' }}>
                <MapEmbed
                  center={{ lat: 20.5937, lng: 78.9629 }}
                  zoom={4}
                  markers={topMarkers.map((marker) => ({ lat: marker.coords!.lat, lng: marker.coords!.lng, label: `${marker.name} · ${jurisdictionMap.find((item) => item.name === marker.name)?.risk}% risk` }))}
                  height="260px"
                />
              </div>
            </div>

            <div style={{ ...panelStyle, borderRadius: 28, padding: 22 }}>
              <div style={sectionTitleStyle()}>Performance chart</div>
              <h2 style={{ margin: '10px 0 0', fontSize: 24, fontWeight: 800, color: '#1a1b1e' }}>Risk versus trust by jurisdiction</h2>
              <div style={{ marginTop: 16, height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={performanceSeries}>
                    <CartesianGrid strokeDasharray="4 4" strokeOpacity={0.16} />
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: '#08111f', borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, color: '#fff' }} />
                    <Bar dataKey="risk" fill="#f97316" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="trust" fill="#22c55e" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <section style={{ ...panelStyle, borderRadius: 28, padding: 22 }}>
                <div style={sectionTitleStyle()}>Junior directory</div>
                <h3 style={{ margin: '10px 0 0', color: '#f8fafc', fontSize: 22, fontWeight: 800 }}>Authority staff</h3>
                <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                  {juniorAuthorities.map((person) => (
                    <div key={person.name} style={{ borderRadius: 18, padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ color: '#f8fafc', fontWeight: 800 }}>{person.name}</div>
                      <div style={{ marginTop: 6, color: '#cbd5e1' }}>{person.role}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ ...panelStyle, borderRadius: 28, padding: 22 }}>
                <div style={sectionTitleStyle()}>Contractor directory</div>
                <h3 style={{ margin: '10px 0 0', color: '#f8fafc', fontSize: 22, fontWeight: 800 }}>Assigned vendors</h3>
                <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                  {contractorDirectory.map((contractor) => (
                    <div key={contractor.companyName} style={{ borderRadius: 18, padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ color: '#f8fafc', fontWeight: 800 }}>{contractor.companyName}</div>
                      <div style={{ marginTop: 6, color: '#cbd5e1' }}>{contractor.specialization}</div>
                      <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>{contractor.status}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ ...panelStyle, borderRadius: 28, padding: 22 }}>
                <div style={sectionTitleStyle()}>Project portfolio</div>
                <h3 style={{ margin: '10px 0 0', color: '#f8fafc', fontSize: 22, fontWeight: 800 }}>Active work</h3>
                <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                  {projectPortfolio.map((project) => (
                    <div key={project.id} style={{ borderRadius: 18, padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ color: '#f8fafc', fontWeight: 800 }}>{project.name}</div>
                      <div style={{ marginTop: 6, color: '#cbd5e1' }}>{project.assignedTo}</div>
                      <div style={{ marginTop: 10, height: 6, borderRadius: 9999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div style={{ width: `${project.progressPct}%`, height: '100%', background: 'linear-gradient(90deg, #8b5cf6 0%, #06b6d4 100%)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 20 }}>
            <section style={{ ...panelStyle, borderRadius: 28, padding: 22 }}>
              <div style={sectionTitleStyle()}>Regional health</div>
              <h3 style={{ margin: '10px 0 0', fontSize: 24, fontWeight: 800, color: '#f8fafc' }}>High-risk jurisdictions</h3>
              <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
                {topDistricts.map((district) => (
                  <div key={district.name} style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: '#e2e8f0', fontSize: 14 }}>
                      <span>{district.name}</span>
                      <span>{district.risk}% risk</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 9999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ width: `${district.risk}%`, height: '100%', background: 'linear-gradient(90deg, #8b5cf6 0%, #06b6d4 100%)' }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section style={{ ...panelStyle, borderRadius: 28, padding: 22 }}>
              <div style={sectionTitleStyle()}>Strategic notes</div>
              <h3 style={{ margin: '10px 0 0', fontSize: 24, fontWeight: 800, color: '#f8fafc' }}>Oversight insights</h3>
              <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                {insights.map((insight) => (
                  <div key={insight.title} style={{ borderRadius: 20, padding: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ color: '#f8fafc', fontWeight: 800 }}>{insight.title}</div>
                    <div style={{ marginTop: 8, color: '#cbd5e1', lineHeight: 1.6 }}>{insight.detail}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
                <button onClick={() => navigate('/authority/report')} style={{ border: 'none', borderRadius: 14, padding: '12px 14px', fontWeight: 800, color: '#08111f', background: 'linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%)', cursor: 'pointer' }}>Generate district report</button>
                <button onClick={() => navigate('/authority/analytics')} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 14px', fontWeight: 800, color: '#e2e8f0', background: 'rgba(255,255,255,0.04)', cursor: 'pointer' }}>Open analytics board</button>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  )
}
