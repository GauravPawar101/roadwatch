
import { Button, Card, CardBody, Container } from '../components/UIComponents'

export default function DistrictReport(){
  return (
    <Container>
      <div style={{ maxWidth:900, margin:'6px auto' }}>
        <h2>District Report</h2>
        <p>PDF-ready report preview (use Export to generate PDF)</p>
        <Card style={{ marginTop: 12 }}>
          <CardBody>
            Report content placeholder: totals, SLA, budget summary, top 5 roads.
          </CardBody>
        </Card>

        <div style={{ marginTop:12, display: 'flex', gap: 8 }}>
          <Button variant="primary">Export PDF</Button>
          <Button variant="ghost">Share link</Button>
        </div>
      </div>
    </Container>
  )
}
