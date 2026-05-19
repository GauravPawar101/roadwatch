import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, CardBody } from '../components/UIComponents'

export default function Escalation(){
  const { id } = useParams()
  const navigate = useNavigate()

  function confirmEscalation(){
    const all = JSON.parse(localStorage.getItem('roadwatch_complaints') || '[]')
    const updated = all.map((c:any)=> c.id===id ? {...c, status:'Escalated'} : c)
    localStorage.setItem('roadwatch_complaints', JSON.stringify(updated))
    alert('Escalation recorded and anchored to chain (simulated)')
    navigate(`/complaints/${id}`)
  }

  return (
    <div className="stitch-maxw-900">
      <Card>
        <CardBody>
          <h2 className="stitch-font-20 stitch-font-800">Escalate Complaint {id}</h2>
          <div className="stitch-mt-8">
            <div>Current authority: Local PWD</div>
            <div>Next escalation: District Commissioner</div>
            <div>Reason: SLA breached or user requested escalation</div>
          </div>
          <div className="stitch-mt-12 stitch-display-flex stitch-gap-8">
            <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
            <Button variant="primary" onClick={confirmEscalation}>Confirm Escalation</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
