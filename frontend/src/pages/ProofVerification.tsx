import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Card, CardBody, Container } from '../components/UIComponents'
import { getRecord } from '../lib/offlineStore'

export default function ProofVerification(){
  const { id } = useParams()
  const [complaint, setComplaint] = useState<any | null>(null)

  useEffect(()=>{
    getRecord('complaints', String(id)).then((found) => setComplaint(found || null))
  }, [id])

  async function verify(proof:any){
    try{
      if (!proof.dataUrl) return alert('No media data stored')
      const res = await fetch(proof.dataUrl)
      const buf = await res.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', buf)
      const hex = Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('')
      const ok = hex === proof.hash
      alert(ok ? 'Verified: hashes match' : 'Tampered: hash mismatch')
    }catch(e:any){ alert('Verification failed: '+e?.message) }
  }

  if (!complaint) return (
    <Container>
      <Card>
        <CardBody>
          <div style={{ textAlign: 'center', padding: 24 }}><h3>Complaint not found</h3></div>
        </CardBody>
      </Card>
    </Container>
  )

  return (
    <Container>
      <h2 style={{ fontSize: 20, fontWeight: 700 }}>Proof Verification — {complaint.id}</h2>
      <div className="stitch-grid stitch-gap-12 stitch-mt-12">
        {complaint.media.map((m:any)=> (
          <Card key={m.id}>
            <CardBody>
              <div className="stitch-display-flex stitch-gap-12">
                {m.type==='photo' ? <img src={m.dataUrl} style={{ width:160 }} className="stitch-rounded-8" /> : <video src={m.dataUrl} controls style={{ width:220 }} className="stitch-rounded-8" />}
                <div>
                  <div><strong>Captured:</strong> {m.timestamp}</div>
                  <div><strong>Coords:</strong> {m.coords?.lat.toFixed(6)}, {m.coords?.lng.toFixed(6)}</div>
                  <div style={{ marginTop:8 }}><strong>SHA256:</strong> {m.hash}</div>
                  <div style={{ marginTop:8 }}><strong>IPFS:</strong> {m.ipfs}</div>
                  <div style={{ marginTop:8 }}><strong>Tx:</strong> {m.tx}</div>
                  <div style={{ marginTop:12 }}>
                    <Button variant="primary" onClick={()=>verify(m)}>Run verification</Button>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </Container>
  )
}
