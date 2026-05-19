import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, CardBody, Container } from '../components/UIComponents'

export default function Notifications(){
  const [notes, setNotes] = useState<any[]>([])
  const navigate = useNavigate()
  useEffect(()=>{
    setNotes(JSON.parse(localStorage.getItem('roadwatch_notifications')||'[]'))
  }, [])

  function open(n:any){
    if (n.type==='complaint') navigate(`/authority/complaint/${n.ref}`)
  }

  return (
    <Container>
      <div style={{ maxWidth:900, margin:'6px auto' }}>
        <h2>Notifications</h2>
        <div style={{ display:'grid', gap:8 }}>
          {notes.map((n,i)=>(
            <Card key={i}>
              <CardBody style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontWeight:700 }}>{n.title}</div>
                  <div style={{ color:'var(--color-muted)' }}>{n.time}</div>
                </div>
                <div>
                  <Button variant="primary" onClick={()=>open(n)}>Open</Button>
                </div>
              </CardBody>
            </Card>
          ))}
          {notes.length===0 && <div style={{ color:'var(--color-muted)' }}>No notifications</div>}
        </div>
      </div>
    </Container>
  )
}
