import { useParams } from 'react-router-dom'
import {
  Alert,
  Badge,
  Card,
  CardBody,
  Container,
  Hero,
  Section,
  StatCard,
  StatsGrid
} from '../components/UIComponents'

export default function BudgetHistory() {
  const { id } = useParams()
  
  const timeline = [
    { date: '2023-01-10', type: 'Sanctioned', amount: '₹12,000,000', source: 'NHAI data' },
    { date: '2023-06-02', type: 'Released', amount: '₹10,000,000', source: 'chain-verified' },
    { date: '2024-02-18', type: 'Spent', amount: '₹11,500,000', source: 'PWD portal', anomaly: true }
  ]

  const stats = {
    sanctioned: 12000000,
    released: 10000000,
    spent: 11500000,
    available: 10000000 - 11500000
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'Sanctioned': return '📋'
      case 'Released': return '✅'
      case 'Spent': return '💸'
      default: return '❓'
    }
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'Sanctioned': return 'info'
      case 'Released': return 'success'
      case 'Spent': return 'warning'
      default: return 'primary'
    }
  }

  return (
    <div className="page-radial-bg min-h-screen py-12 text-on-surface">
      <Container>
      <Hero
        title={`Budget History — Road ${id}`}
        subtitle="Track budget allocation, release, and spending timeline"
      />

      {/* Summary Stats */}
      <StatsGrid>
        <StatCard value={`₹${(stats.sanctioned / 1000000).toFixed(1)}M`} label="Sanctioned" icon="📋" />
        <StatCard value={`₹${(stats.released / 1000000).toFixed(1)}M`} label="Released" icon="✅" />
        <StatCard value={`₹${(stats.spent / 1000000).toFixed(1)}M`} label="Spent" icon="💸" />
        <StatCard value={`₹${(stats.available / 1000000).toFixed(1)}M`} label="Available" icon="💼" />
      </StatsGrid>

      {/* Anomaly Alert */}
      {stats.spent > stats.released && (
        <Alert variant="error" title="⚠️ Budget Anomaly Detected">
          Amount spent (₹{(stats.spent / 1000000).toFixed(1)}M) exceeds amount released (₹{(stats.released / 1000000).toFixed(1)}M). This requires immediate investigation.
        </Alert>
      )}

      {/* Timeline */}
      <Section title={`Transaction Timeline (${timeline.length} entries)`}>
        <div className="stitch-grid stitch-gap-4">
          {timeline.map((t, idx) => (
            <div key={idx} style={{ position: 'relative', paddingLeft: 'var(--spacing-8)' }}>
              {/* Timeline dot */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 'var(--spacing-3)',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: t.anomaly ? 'var(--color-error)' : 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: 700,
                  boxShadow: 'var(--shadow-md)'
                }}
              >
                {idx + 1}
              </div>

              {/* Timeline card */}
              <Card interactive>
                <CardBody>
                  <div className="stitch-display-flex stitch-justify-between stitch-gap-4" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <div className="stitch-display-flex stitch-items-center stitch-gap-2" style={{ marginBottom: 'var(--spacing-2)' }}>
                        <span style={{ fontSize: '24px' }}>{getTypeIcon(t.type)}</span>
                        <h4 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>
                          {t.type}
                        </h4>
                      </div>
                      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
                        📅 {new Date(t.date).toLocaleDateString()} • 📌 {t.source}
                      </p>
                    </div>
                    <div className="stitch-text-right">
                      <p style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-primary)', margin: 0 }}>
                        {t.amount}
                      </p>
                      <Badge variant={getTypeColor(t.type) as any}>{t.type}</Badge>
                    </div>
                  </div>
                  {t.anomaly && (
                    <div style={{ marginTop: 'var(--spacing-3)', padding: 'var(--spacing-2) var(--spacing-3)', background: 'rgba(232, 76, 61, 0.1)', borderLeft: '3px solid var(--color-error)', borderRadius: 'var(--radius-sm)' }}>
                      <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-error)' }}>
                        ⚠️ Anomaly: Spending exceeds released amount
                      </p>
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
          ))}
        </div>
      </Section>

      {/* Summary */}
      <Section title="Budget Analysis">
        <Card>
          <CardBody>
            <div className="stitch-grid stitch-gap-3">
              <div className="stitch-display-flex stitch-justify-between stitch-items-center" style={{ paddingBottom: 'var(--spacing-2)', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>Utilization Rate</span>
                <span style={{ fontWeight: 700 }}>
                  {Math.round((stats.spent / stats.sanctioned) * 100)}%
                </span>
              </div>
              <div className="stitch-display-flex stitch-justify-between stitch-items-center" style={{ paddingBottom: 'var(--spacing-2)', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>Release Efficiency</span>
                <span style={{ fontWeight: 700 }}>
                  {Math.round((stats.released / stats.sanctioned) * 100)}%
                </span>
              </div>
              <div className="stitch-display-flex stitch-justify-between stitch-items-center">
                <span style={{ color: 'var(--color-text-secondary)' }}>Spending Status</span>
                <Badge variant={stats.spent > stats.released ? 'error' : 'success'}>
                  {stats.spent > stats.released ? '⚠️ Over Budget' : '✓ Within Budget'}
                </Badge>
              </div>
            </div>
          </CardBody>
        </Card>
      </Section>
      </Container>
    </div>
  )
}
