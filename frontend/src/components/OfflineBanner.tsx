import { useEffect, useState } from 'react'
import { getPendingQueueCount, getSyncMeta, processQueue } from '../lib/offlineStore'
import { Alert } from './UIComponents'

export default function OfflineBanner() {
  const [pending, setPending] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)

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

    async function syncNow() {
      if (!navigator.onLine || syncing) return
      setSyncing(true)
      try {
        await processQueue()
        await refresh()
      } finally {
        if (mounted) setSyncing(false)
      }
    }

    refresh()

    const onOnline = () => {
      setOnline(true)
      void syncNow()
    }
    const onOffline = () => {
      setOnline(false)
      void refresh()
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const timer = window.setInterval(refresh, 5000)

    return () => {
      mounted = false
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.clearInterval(timer)
    }
  }, [syncing])

  if (online && pending === 0) return null

  return (
    <Alert variant={online ? 'warning' : 'error'} style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 14 }}>
          <strong style={{ fontWeight: 700 }}>
            {online ? (syncing ? 'Syncing…' : 'Sync pending') : 'Offline mode'}
          </strong>
          <span style={{ marginLeft: 8, color: 'var(--color-text-secondary)' }}>
            Queue: {pending} · Last sync: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Never'}
            {!online ? ' · Reports and photos are cached on this device' : ''}
          </span>
        </div>
        {online && pending > 0 && (
          <button
            type="button"
            onClick={() => void processQueue().then(() => getPendingQueueCount().then(setPending))}
            disabled={syncing}
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'transparent',
              cursor: syncing ? 'wait' : 'pointer',
            }}
          >
            Sync now
          </button>
        )}
      </div>
    </Alert>
  )
}
