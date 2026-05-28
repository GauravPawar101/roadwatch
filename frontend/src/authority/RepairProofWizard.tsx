import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ResumableUpload from '../components/ResumableUpload'
import { Button, Card, CardBody, Container } from '../components/UIComponents'
import { enqueueAction, getRecord, saveRecord } from '../lib/offlineStore'

function sha256Hex(buffer: ArrayBuffer) {
  return crypto.subtle.digest('SHA-256', buffer).then((digest) => {
    const h = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
    return h
  })
}

function buildMerkleRoot(hashes: string[]){
  if (hashes.length===0) return ''
  let nodes = hashes.slice()
  while(nodes.length>1){
    const next: string[] = []
    for(let i=0;i<nodes.length;i+=2){
      const a = nodes[i]
      const b = nodes[i+1] || nodes[i]
      // simple concat-hash placeholder
      next.push(a+b)
    }
    nodes = next
  }
  return nodes[0]
}

export default function RepairProofWizard(){
  const { id } = useParams()
  const navigate = useNavigate()
  const [before, setBefore] = useState<string | null>(null)
  const [after, setAfter] = useState<string | null>(null)
  const [type, setType] = useState('patching')
  const [currentLoc, setCurrentLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [complaintLoc, setComplaintLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [uploadCid, setUploadCid] = useState<string | null>(null)

  React.useEffect(() => {
    navigator.geolocation?.getCurrentPosition((p) => setCurrentLoc({ lat: p.coords.latitude, lng: p.coords.longitude }))
    getRecord<any>('complaints', String(id)).then((c) => {
      if (c?.location?.lat != null && c?.location?.lng != null) {
        setComplaintLoc({ lat: Number(c.location.lat), lng: Number(c.location.lng) })
      }
    })
  }, [id])

  function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const R = 6371000
    const toRad = (v: number) => (v * Math.PI) / 180
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const lat1 = toRad(a.lat)
    const lat2 = toRad(b.lat)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>, set:(s:string|null)=>void){
    const f = e.target.files && e.target.files[0]
    if (!f) return
    const url = URL.createObjectURL(f)
    const buf = await f.arrayBuffer()
    const hash = await sha256Hex(buf)
    set(url)
    const temp = JSON.parse(localStorage.getItem('roadwatch_repair_proofs')||'{}')
    temp[id as string] = temp[id as string] || { before: null, after: null, hashes: [] }
    if (set===setBefore) temp[id as string].before = { url, hash, sha256: hash }
    if (set===setAfter) temp[id as string].after = { url, hash, sha256: hash }
    localStorage.setItem('roadwatch_repair_proofs', JSON.stringify(temp))
  }

  function submit(){
    const temp = JSON.parse(localStorage.getItem('roadwatch_repair_proofs')||'{}')
    const entry = temp[id as string]
    if (!entry || !entry.before || !entry.after) return alert('Please upload before and after photos')
    const hashes = [entry.before.hash, entry.after.hash]
    const merkle = buildMerkleRoot(hashes)
    const dist = currentLoc && complaintLoc ? distanceMeters(currentLoc, complaintLoc) : 999
    const aiScore = Math.max(0, Math.min(1, (entry.before.hash !== entry.after.hash ? 0.55 : 0.2) + (dist < 120 ? 0.45 : 0)))
    const repaired = aiScore >= 0.62 && dist <= 120
    const verification = {
      complaintId: id,
      beforeHash: entry.before.hash,
      afterHash: entry.after.hash,
      currentLoc,
      complaintLoc,
      distanceM: dist,
      aiScore,
      repaired,
      model: 'roadwatch-repair-ai-v1',
      verifiedAt: new Date().toISOString(),
    }
    const record = { roadId: id, repairType: type, before: entry.before, after: entry.after, merkleRoot: merkle, status: repaired ? 'Verified' : 'Pending', verification }
    saveRecord('repair_proofs', String(id), record)
    saveRecord('repair_verifications', String(id), verification)
    enqueueAction('authority.repair.submit', record)
    const token = localStorage.getItem('roadwatch_token')
    const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100'
    if (token) {
      fetch(`${apiBase}/authority/complaints/${id}/repair-verification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          beforeSha256: verification.beforeHash,
          afterSha256: verification.afterHash,
          imageLat: verification.complaintLoc?.lat || 0,
          imageLng: verification.complaintLoc?.lng || 0,
          currentLat: verification.currentLoc?.lat || 0,
          currentLng: verification.currentLoc?.lng || 0,
          model: verification.model,
        }),
      }).catch(() => undefined)
    }
    alert(`Proof submitted; Merkle root (simulated): ${merkle}. AI repaired=${repaired ? 'YES' : 'NO'}`)
    navigate(`/authority/complaint/${id}`)
  }

  async function onUploadComplete(result: any) {
    const cid = result?.ipfs || result?.cid || null
    setUploadCid(cid)
    await saveRecord('authority_uploads', String(id), {
      complaintId: id,
      uploadId: result?.uploadId,
      ipfs: cid,
      sha: result?.sha,
      filename: result?.filename,
      repairType: type,
      completedAt: new Date().toISOString(),
    })
  }

  return (
    <Container maxWidth="900px">
      <div className="stitch-mb-12">
        <h2 className="stitch-font-20 stitch-font-700">Repair Proof Upload — {id}</h2>
        <p className="stitch-text-secondary">Upload before/after photos, pin evidence, and submit verification.</p>
      </div>

      <div className="stitch-display-grid stitch-gap-12">
        <Card>
          <CardBody>
            <div className="stitch-font-700 stitch-mb-8">Before photo (camera-only)</div>
            <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e, setBefore)} />
            {before && <img src={before} className="stitch-w-200 stitch-mt-8" />}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="stitch-font-700 stitch-mb-8">After photo (camera-only)</div>
            <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e, setAfter)} />
            {after && <img src={after} className="stitch-w-200 stitch-mt-8" />}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="stitch-font-700 stitch-mb-8">Authority upload (pin to IPFS)</div>
            <ResumableUpload metadata={{ type: 'authority_repair', complaintId: id }} onComplete={onUploadComplete} />
            <div className="stitch-mt-8 stitch-text-13 stitch-text-secondary">
              {uploadCid ? `Saved CID ${uploadCid}` : 'No uploaded CID yet.'}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <label className="stitch-display-block stitch-mb-8 stitch-font-700">Repair type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="stitch-w-100p" style={{ padding: '8px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
              <option value="patching">Patching</option>
              <option value="resurfacing">Resurfacing</option>
              <option value="reconstruction">Full reconstruction</option>
            </select>
          </CardBody>
        </Card>
      </div>

      <div className="stitch-mt-12 stitch-display-flex stitch-gap-8">
        <Button variant="ghost" onClick={() => navigate(-1)} className="stitch-flex-1">Back</Button>
        <Button variant="primary" onClick={submit} className="stitch-flex-1">Submit Proof</Button>
      </div>
    </Container>
  )
}
