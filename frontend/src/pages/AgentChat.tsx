import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Card, CardBody, Container, Input } from '../components/UIComponents'
import { getActiveRole, getRoleLabel } from '../lib/session'

export default function AgentChat() {
  const { id } = useParams()
  const role = getActiveRole()
  const [messages, setMessages] = useState<{from:string,text:string}[]>([
    { from: 'system', text: `${getRoleLabel(role)} assistant ready. Road context preloaded for ${id}.` }
  ])
  const [input, setInput] = useState('')
  const prompt = role === 'authority'
    ? 'Authority can assign inspectors, update status, and generate reports.'
    : role === 'contractor'
      ? 'Contractor can query project status, condition score, and defect liability timing only.'
      : 'Citizen can file complaints, check status, and verify proofs.'

  function send() {
    if (!input) return
    setMessages((m) => [...m, { from: 'user', text: input }])
    setMessages((m) => [...m, { from: 'bot', text: `Echo: ${input}` }])
    setInput('')
  }

  return (
    <Container maxWidth="800px">
      <h2>Agent Chat — Road {id}</h2>
      <p className="stitch-text-muted">{prompt}</p>

      <Card>
        <CardBody>
          <div className="bg-surface-container-low min-h-[200px]">
            <div className="stitch-p-12 stitch-rounded-8">
              {messages.map((m, i) => (
                <div key={i} className="stitch-mb-8"><strong>{m.from}:</strong> <span className="stitch-text-muted">{m.text}</span></div>
              ))}
            </div>
          </div>

          <div className="stitch-display-flex stitch-gap-8 stitch-mt-12">
            <Input value={input} onChange={(e:any) => setInput(e.target.value)} className="stitch-flex-1" />
            <Button variant="primary" onClick={send}>Send</Button>
          </div>
        </CardBody>
      </Card>
    </Container>
  )
}
