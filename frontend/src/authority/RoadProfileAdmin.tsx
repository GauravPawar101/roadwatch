import { useParams } from 'react-router-dom'
import { Button, Card, CardBody, Container, Input } from '../components/UIComponents'

export default function RoadProfileAdmin(){
  const { id } = useParams()
  return (
    <Container>
      <div className="stitch-maxw-900" style={{ margin: '6px auto' }}>
        <h2>Road Profile — Admin — {id}</h2>
        <Card className="stitch-mt-12">
          <CardBody>
            <div><strong>Contractor</strong></div>
            <Input defaultValue={'ABC Infra'} className="stitch-mt-8" />
            <div className="stitch-mt-8">
              <Button variant="primary" className="stitch-mr-8">Save</Button>
              <Button variant="ghost">Flag priority</Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </Container>
  )
}
