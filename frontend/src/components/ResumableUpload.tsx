import { useRef, useState } from 'react'
import { captureGeoPosition } from '../lib/geoCapture'
import { saveOfflineMedia } from '../lib/offlineMedia'
import { FormGroup, Input, ProgressBar } from './UIComponents'

export type MediaCaptureResult = {
  uploadId?: string
  ipfs?: string
  sha?: string
  filename?: string
  capturedLat: number
  capturedLng: number
  capturedAt: string
  offline?: boolean
  localMediaId?: string
}

type Props = {
  onComplete?: (result: MediaCaptureResult) => void
  metadata?: Record<string, unknown>
}

export default function ResumableUpload({ onComplete, metadata }: Props) {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<'idle' | 'capturing' | 'uploading' | 'cached' | 'done' | 'error'>('idle')
  const [captureLabel, setCaptureLabel] = useState('')
  const fileRef = useRef<File | null>(null)
  const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB

  async function initUpload(filename: string, totalSize: number) {
    const api = (import.meta as any).env?.VITE_MEDIA_INGEST_URL || 'http://localhost:4000'
    const res = await fetch(`${api}/api/uploads/chunk/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, totalSize, metadata }),
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
      xhr.send(chunk)
    })
  }

  async function completeUpload(uploadId: string, filename: string) {
    const api = (import.meta as any).env?.VITE_MEDIA_INGEST_URL || 'http://localhost:4000'
    const res = await fetch(`${api}/api/uploads/chunk/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, filename }),
    })
    return res.json()
  }

  async function cacheOffline(f: File, capture: { lat: number; lng: number; capturedAt: string }) {
    const localMediaId = `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await saveOfflineMedia(localMediaId, f, {
      filename: f.name,
      mimeType: f.type || 'image/jpeg',
      capturedLat: capture.lat,
      capturedLng: capture.lng,
      capturedAt: capture.capturedAt,
    })
    setStatus('cached')
    setProgress(100)
    onComplete?.({
      filename: f.name,
      capturedLat: capture.lat,
      capturedLng: capture.lng,
      capturedAt: capture.capturedAt,
      offline: true,
      localMediaId,
    })
  }

  async function handleFile(f: File) {
    fileRef.current = f
    setStatus('capturing')
    const capture = await captureGeoPosition()
    setCaptureLabel(`${capture.lat.toFixed(4)}, ${capture.lng.toFixed(4)} · ${new Date(capture.capturedAt).toLocaleString()}`)

    if (!navigator.onLine) {
      await cacheOffline(f, capture)
      return
    }

    setStatus('uploading')
    try {
      const init = await initUpload(f.name, f.size)
      if (!init?.uploadId) {
        await cacheOffline(f, capture)
        return
      }

      const chunkSize = init.chunkSize || CHUNK_SIZE
      const total = f.size
      let offset = 0
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
      onComplete?.({
        uploadId: done?.uploadId,
        ipfs: done?.ipfs,
        sha: done?.sha,
        filename: f.name,
        capturedLat: capture.lat,
        capturedLng: capture.lng,
        capturedAt: capture.capturedAt,
      })
    } catch (e) {
      console.warn('[upload] online upload failed, caching locally', e)
      try {
        await cacheOffline(f, capture)
      } catch (cacheErr) {
        console.error(cacheErr)
        setStatus('error')
      }
    }
  }

  return (
    <div>
      <FormGroup label="Attach geotagged photo (camera or gallery)">
        <Input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
        />
      </FormGroup>

      {status === 'capturing' && (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Capturing GPS and timestamp…
        </div>
      )}

      {status === 'uploading' && (
        <div style={{ marginTop: 8 }}>
          <ProgressBar progress={progress} />
        </div>
      )}

      {(status === 'done' || status === 'cached') && (
        <div style={{ marginTop: 8, color: 'var(--color-success)', fontSize: 13 }}>
          {status === 'cached' ? 'Saved on device — will sync when online' : 'Upload complete'}
          {captureLabel ? <div style={{ marginTop: 4, color: 'var(--color-text-secondary)' }}>{captureLabel}</div> : null}
        </div>
      )}

      {status === 'error' && (
        <div style={{ marginTop: 8, color: 'var(--color-error)' }}>Could not save photo. Try again.</div>
      )}
    </div>
  )
}
