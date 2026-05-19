import { useState } from 'react'
import { Button, Card, CardBody, Container, Input } from '../components/UIComponents'

export default function AgentChatContractor(){
  const [messages, setMessages] = useState([{ from: 'system', text: 'Contractor role active. Read-only queries only.' }])
  const [input, setInput] = useState('')

  function send(){
    if (!input.trim()) return
    setMessages((prev) => [...prev, { from: 'user', text: input }, { from: 'assistant', text: `Mock answer for: ${input}` }])
    setInput('')
  }

  return (
    <Container>
      <div className="stitch-maxw-900">
        <h2>Agent Chat — Contractor View</h2>
        <Card className="stitch-mt-12" style={{ minHeight: 240 }}>
          <CardBody>
            {messages.map((m, i) => (
              <div key={i} className="stitch-mb-8"><strong>{m.from}:</strong> <span className="stitch-text-muted">{m.text}</span></div>
            ))}
          </CardBody>
        </Card>
        <div className="stitch-display-flex stitch-gap-8 stitch-mt-12">
          <Input value={input} onChange={(e:any) => setInput(e.target.value)} placeholder="Ask about open complaints, condition score, DLP end date..." className="stitch-flex-1" />
          <Button variant="primary" onClick={send}>Send</Button>
        </div>
      </div>
    </Container>
  )
}
