import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CardBody,
  Container,
  Divider,
  FormGroup,
  Hero,
  Input,
  Section,
  Select,
  StatCard,
  StatsGrid,
} from '../components/UIComponents'
import { authorityProfiles, citizenProfile, complaints, contractorProfiles, jurisdictionMap } from '../data/roadwatchDashboard'
import { listRecords } from '../lib/offlineStore'

type ComplaintRecord = {
  id: string
  roadId: string
  title: string
  damageType?: string
  severity?: number
  status: string
  createdAt: string
  description?: string
}

const roleLabels: Record<string, string> = {
  citizen: 'Citizen profile',
  authority: 'Authority profile',
  contractor: 'Contractor profile',
  'super-admin': 'Super admin profile',
}

export default function Settings() {
  const navigate = useNavigate()
  const role = (localStorage.getItem('roadwatch_role') || 'citizen').toLowerCase()
  const [personalComplaints, setPersonalComplaints] = useState<ComplaintRecord[]>([])

  useEffect(() => {
    listRecords<ComplaintRecord>('complaints')
      .then((records) => setPersonalComplaints(records))
      .catch(() => setPersonalComplaints([]))
  }, [])

  const profileSummary = useMemo(() => {
    if (role === 'citizen') {
      return [
        { value: citizenProfile.trustScore, label: 'Trust score' },
        { value: citizenProfile.totalSubmitted, label: 'Submitted' },
        { value: citizenProfile.resolved, label: 'Resolved' },
        { value: citizenProfile.rewardPoints, label: 'Reward points' },
      ]
    }

    if (role === 'authority') {
      const profile = authorityProfiles[1] ?? authorityProfiles[0]
      return [
        { value: profile.efficiencyScore, label: 'Efficiency' },
        { value: jurisdictionMap.length, label: 'Jurisdictions' },
        { value: jurisdictionMap.reduce((sum, item) => sum + item.openCases, 0), label: 'Open cases' },
        { value: `${Math.round(jurisdictionMap.reduce((sum, item) => sum + item.risk, 0) / jurisdictionMap.length)}%`, label: 'Risk index' },
      ]
    }

    if (role === 'contractor') {
      const profile = contractorProfiles[0]
      return [
        { value: profile.performanceScore, label: 'Performance' },
        { value: profile.slaScore, label: 'SLA score' },
        { value: profile.authorityRating, label: 'Authority rating' },
        { value: profile.regions.length, label: 'Regions' },
      ]
    }

    return [
      { value: complaints.filter((item) => item.status !== 'Resolved').length, label: 'Open cases' },
      { value: jurisdictionMap.length, label: 'Mapped jurisdictions' },
      { value: Math.round(jurisdictionMap.reduce((sum, item) => sum + item.trust, 0) / jurisdictionMap.length), label: 'Trust average' },
      { value: complaints.filter((item) => item.severity >= 8).length, label: 'Critical items' },
    ]
  }, [role])

  const recentItems = role === 'citizen'
    ? (personalComplaints.length > 0 ? personalComplaints : complaints.slice(0, 4).map((item) => ({ id: item.id, roadId: item.roadId, title: item.title, damageType: item.category, severity: item.severity, status: item.status, createdAt: item.createdAt, description: item.title })))
    : complaints.slice(0, 4).map((item) => ({ id: item.id, roadId: item.roadId, title: item.title, damageType: item.category, severity: item.severity, status: item.status, createdAt: item.createdAt, description: item.title }))

  return (
    <div className="page-radial-bg min-h-screen py-12 text-on-surface">
    <Container>
      <Hero
        title="Profile & Settings"
        subtitle="Inspect your role performance, review recent activity, and tune your account preferences."
        actions={(
          <div className="stitch-display-flex stitch-gap-8 stitch-flex-wrap">
            <Badge variant="primary">{roleLabels[role] || role}</Badge>
            <Button variant="ghost" onClick={() => navigate('/map')}>Open map</Button>
            <Button variant="ghost" onClick={() => navigate('/complaints')}>My complaints</Button>
          </div>
        )}
      />

      <StatsGrid>
        {profileSummary.map((item) => (
          <StatCard key={item.label} value={item.value} label={item.label} />
        ))}
      </StatsGrid>

      <section style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16, marginTop: 16 }}>
        <Card>
          <CardBody>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Account overview</div>
            <div className="stitch-grid stitch-gap-12" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 14 }}>
              <Card>
                <CardBody>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Role</div>
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700 }}>{roleLabels[role] || role}</div>
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Status</div>
                  <div style={{ marginTop: 6 }}><Badge variant="success">Active</Badge></div>
                </CardBody>
              </Card>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Recent activity</div>
              <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                {recentItems.map((item) => (
                  <Card key={item.id} interactive>
                    <CardBody>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 800 }}>{item.title}</div>
                          <div style={{ marginTop: 6, color: 'var(--color-text-secondary)', fontSize: 14 }}>{item.roadId}</div>
                        </div>
                        <Badge variant={item.status === 'Resolved' ? 'success' : item.status.includes('Escal') ? 'error' : 'info'}>{item.status}</Badge>
                      </div>
                      <div style={{ marginTop: 10, color: 'var(--color-text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
                        {item.description || 'No description available.'}
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Role snapshot</div>
            <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
              {role === 'citizen' && (
                <>
                  <div style={{ borderRadius: 16, padding: 14, background: 'var(--card-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 700 }}>Handle</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>{citizenProfile.handle}</div>
                  </div>
                  <div style={{ borderRadius: 16, padding: 14, background: 'var(--card-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 700 }}>Pending</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>{citizenProfile.pending}</div>
                  </div>
                </>
              )}

              {role === 'authority' && (
                <>
                  <div style={{ borderRadius: 16, padding: 14, background: 'var(--card-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 700 }}>Coverage</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>{authorityProfiles[1]?.scope ?? authorityProfiles[0]?.scope}</div>
                  </div>
                  <div style={{ borderRadius: 16, padding: 14, background: 'var(--card-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 700 }}>High-risk regions</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>{jurisdictionMap.slice(0, 3).map((item) => item.name).join(', ')}</div>
                  </div>
                </>
              )}

              {role === 'contractor' && (
                <>
                  <div style={{ borderRadius: 16, padding: 14, background: 'var(--card-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 700 }}>Certified regions</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>{contractorProfiles[0]?.regions.join(', ')}</div>
                  </div>
                  <div style={{ borderRadius: 16, padding: 14, background: 'var(--card-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 700 }}>Certification</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>{contractorProfiles[0]?.certificationStatus}</div>
                  </div>
                </>
              )}

              {role === 'super-admin' && (
                <>
                  <div style={{ borderRadius: 16, padding: 14, background: 'var(--card-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 700 }}>Top risk zone</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>{jurisdictionMap.slice().sort((left, right) => right.risk - left.risk)[0]?.name}</div>
                  </div>
                  <div style={{ borderRadius: 16, padding: 14, background: 'var(--card-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 700 }}>State oversight</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>Complaint routing, trust, and audit controls</div>
                  </div>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      </section>

      <Section title="Preferences">
        <Card interactive>
          <CardBody>
            <div className="stitch-grid stitch-gap-16">
              <FormGroup label="Language" required>
                <Select
                  options={[
                    { label: 'English', value: 'en' },
                    { label: 'हिन्दी (Hindi)', value: 'hi' },
                    { label: 'Tamil', value: 'ta' },
                    { label: 'Telugu', value: 'te' }
                  ]}
                  defaultValue={localStorage.getItem('roadwatch_language') || 'en'}
                  onChange={(event) => localStorage.setItem('roadwatch_language', event.target.value)}
                />
              </FormGroup>

              <Divider />

              <FormGroup label="Notifications" required>
                <Select
                  options={[
                    { label: 'All notifications', value: 'all' },
                    { label: 'Important only', value: 'important' },
                    { label: 'Disabled', value: 'disabled' }
                  ]}
                  defaultValue="all"
                />
              </FormGroup>

              <Divider />

              <FormGroup label="Theme">
                <Select
                  options={[
                    { label: 'Light', value: 'light' },
                    { label: 'Dark', value: 'dark' },
                    { label: 'Auto', value: 'auto' }
                  ]}
                  defaultValue="light"
                />
              </FormGroup>
            </div>
          </CardBody>
        </Card>
      </Section>

      <Section title="Offline & Sync">
        <Card interactive>
          <CardBody>
            <p className="stitch-text-muted">Offline maps, sync controls, and local evidence remain accessible here.</p>
            <div className="stitch-display-flex stitch-gap-12 stitch-flex-wrap">
              <Button variant="primary" onClick={() => navigate('/map')}>Open map</Button>
              <Button variant="secondary" onClick={() => navigate('/sync-status')}>View sync status</Button>
            </div>
            <Divider />
            <p className="stitch-text-12 stitch-text-muted">
              Cached complaints: {personalComplaints.length || complaints.length} | Jurisdictions visible: {jurisdictionMap.length}
            </p>
          </CardBody>
        </Card>
      </Section>

      <Section title="Security & Wallet">
        <Card interactive>
          <CardBody>
            <FormGroup label="Connected Wallet Address (Optional)" helperText="Connect a wallet if you need blockchain-backed proof export.">
              <Input type="text" placeholder="0x..." defaultValue="" />
            </FormGroup>
            <div className="stitch-display-flex stitch-gap-12 stitch-flex-wrap">
              <Button variant="primary" type="button">Connect wallet</Button>
              <Button variant="ghost" onClick={() => navigate('/authority/report')}>Export report</Button>
            </div>
          </CardBody>
        </Card>
      </Section>

      <Section title="Danger Zone">
        <Card interactive>
          <CardBody>
            <div className="stitch-border-left-error">
              <p className="stitch-text-muted">These actions are permanent and cannot be undone.</p>
              <div className="stitch-display-flex stitch-gap-12 stitch-flex-wrap">
                <Button variant="secondary">Clear local data</Button>
                <Button variant="danger">Logout</Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </Section>
    </Container>
    </div>
  )
}