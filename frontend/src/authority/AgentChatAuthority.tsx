import { useParams } from 'react-router-dom'
import { Card, CardBody, Container } from '../components/UIComponents'

export default function AgentChatAuthority(){
  const { id } = useParams()
  return (
    <Container>
      <div className="stitch-maxw-900">
        <h2>Authority Agent Chat</h2>
        <p>Role: Authority. Preloaded context: {id || 'district'}</p>
        <Card className="stitch-mt-12">
          <CardBody>Chat UI placeholder (actions: assign, escalate, report generation)</CardBody>
        </Card>
      </div>
    </Container>
  )
}
