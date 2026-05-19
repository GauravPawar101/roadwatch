import React, { useState } from 'react'
import { Button, FormGroup, Input } from './UIComponents'

export default function MediaUpload() {
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return setStatus('Please choose a file')
    setStatus('Uploading...')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch((import.meta as any).env?.VITE_MEDIA_INGEST_URL || 'http://localhost:4000/api/uploads/upload', {
        method: 'POST',
        body: form,
      })
      const json = await res.json()
      if (!res.ok) {
        setStatus('Upload failed: ' + (json?.error || res.statusText))
      } else {
        setStatus('OK: ' + JSON.stringify(json))
      }
    } catch (err: any) {
      setStatus('Error: ' + err.message)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 18 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Upload Media (Pinata-backed)</h2>
      <form onSubmit={upload}>
        <FormGroup label="Choose file">
          <Input type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </FormGroup>
        <div style={{ marginTop: 8 }}>
          <Button type="submit" variant="primary">Upload</Button>
        </div>
      </form>
      {status && <pre style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--color-surface-muted)', fontSize: 13 }}>{status}</pre>}
    </div>
  )
}
