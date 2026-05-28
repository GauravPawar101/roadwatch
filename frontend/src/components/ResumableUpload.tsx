import { useRef, useState } from 'react'
import { FormGroup, Input, ProgressBar } from './UIComponents'

type Props = {
  onComplete?: (result: any) => void
  metadata?: any
}

export default function ResumableUpload({ onComplete, metadata }: Props) {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<'idle'|'uploading'|'done'|'error'>('idle')
  const [uploadId, setUploadId] = useState<string | null>(null)
  const fileRef = useRef<File | null>(null)
  const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB

  async function initUpload(filename: string, totalSize: number) {
    const api = (import.meta as any).env?.VITE_MEDIA_INGEST_URL || 'http://localhost:4000'
    const res = await fetch(`${api}/api/uploads/chunk/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, totalSize, metadata })
    })
    return res.json()
  }

  async function uploadChunk(uploadId: string, chunk: Blob) {
    const api = (import.meta as any).env?.VITE_MEDIA_INGEST_URL || 'http://localhost:4000'
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', `${api}/api/uploads/chunk/${uploadId}`)
      xhr.responseType = 'json'
      xhr.setRequestHeader('Content-Type', 'application/octet-stream')
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response)
        else reject(new Error('chunk upload failed'))
      }
      xhr.onerror = () => reject(new Error('network'))
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          // Not used globally; chunk-level
        }
      }
      xhr.send(chunk)
    })
  }

  async function completeUpload(uploadId: string, filename: string) {
    const api = (import.meta as any).env?.VITE_MEDIA_INGEST_URL || 'http://localhost:4000'
    const res = await fetch(`${api}/api/uploads/chunk/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, filename })
    })
    return res.json()
  }

  async function handleFile(f: File) {
    fileRef.current = f
    setStatus('uploading')
    const init = await initUpload(f.name, f.size)
    if (!init?.uploadId) return setStatus('error')
    setUploadId(init.uploadId)
    const chunkSize = init.chunkSize || CHUNK_SIZE
    const total = f.size
    let offset = 0
    try {
      while (offset < total) {
        const end = Math.min(offset + chunkSize, total)
        const chunk = f.slice(offset, end)
        await uploadChunk(init.uploadId, chunk)
        offset = end
        setProgress(Math.round((offset / total) * 100))
      }
      const done = await completeUpload(init.uploadId, f.name)
      setStatus('done')
      setProgress(100)
      onComplete && onComplete(done)
    } catch (e) {
      console.error(e)
      setStatus('error')
    }
  }

  return (
    <div>
      <FormGroup label="Attach photo or video">
        <Input type="file" accept="image/*,video/*" onChange={(e: any) => { const f = e.target.files && e.target.files[0]; if (f) handleFile(f) }} />
      </FormGroup>

      {status === 'uploading' && (
        <div style={{ marginTop: 8 }}>
          <ProgressBar progress={progress} />
        </div>
      )}

      {status === 'done' && <div style={{ marginTop: 8, color: 'var(--color-success)' }}>Upload complete</div>}
      {status === 'error' && <div style={{ marginTop: 8, color: 'var(--color-error)' }}>Upload failed</div>}
    </div>
  )
}
