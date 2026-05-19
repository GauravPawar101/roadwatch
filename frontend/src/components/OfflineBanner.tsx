import { useEffect, useState } from 'react'
import { getPendingQueueCount, getSyncMeta } from '../lib/offlineStore'
import { Alert } from './UIComponents'

export default function OfflineBanner() {
  const [pending, setPending] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    let mounted = true
    async function refresh() {
      const meta = await getSyncMeta()
      const count = await getPendingQueueCount()
      if (!mounted) return
      setPending(count)
      setLastSyncAt(meta.lastSyncAt)
      setOnline(navigator.onLine)
    }
    refresh()
    const handle = () => refresh()
    window.addEventListener('online', handle)
    window.addEventListener('offline', handle)
    const timer = window.setInterval(refresh, 5000)
    return () => {
      mounted = false
      window.removeEventListener('online', handle)
      window.removeEventListener('offline', handle)
      window.clearInterval(timer)
    }
  }, [])

  if (online && pending === 0) return null

  return (
    <Alert variant={online ? 'warning' : 'error'} style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 14 }}>
          <strong style={{ fontWeight: 700 }}>{online ? 'Sync pending' : 'Offline mode'}</strong>
          <span style={{ marginLeft: 8, color: 'var(--color-text-secondary)' }}>Queue: {pending} · Last sync: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Never'}</span>
        </div>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-secondary)' }}>Non-blocking banner</div>
      </div>
    </Alert>
  )
}
