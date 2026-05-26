import { useParams } from 'react-router-dom'
import { Card, CardBody, Container } from '../components/UIComponents'

export default function RoadHistory() {
  const { id } = useParams()
  const budgets = [
    { year: 2023, amount: '₹12,000,000', contractor: 'ABC Infra' },
    { year: 2024, amount: '₹9,500,000', contractor: 'SkyBuild' },
  ]

  return (
    <div className="page-radial-bg min-h-screen py-12 text-on-surface">
      <Container>
      <div style={{ maxWidth: 900, margin: '20px auto' }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.03em' }}>Budget & Contractor History — {id}</h2>
        <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          {budgets.map((b) => (
            <Card key={b.year} className="glass-panel rounded-2xl">
              <CardBody>
                <div style={{ fontWeight: 700 }}>{b.year} — {b.amount}</div>
                <div style={{ color: 'var(--color-text-secondary)' }}>Contractor: {b.contractor}</div>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
      </Container>
    </div>
  )
}
