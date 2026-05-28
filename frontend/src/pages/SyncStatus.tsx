import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, CardBody, ProgressBar, StatCard, StatsGrid } from '../components/UIComponents'
import { getPendingQueueCount, getSyncMeta, listQueue, processQueue } from '../lib/offlineStore'

type SyncMeta = {
  lastBlockchainSyncBlock: string
  lastGovernmentSyncAt: string
  lastSyncAt: string
  offlineTileCacheSize: string
}

export default function SyncStatus() {
  const [pending, setPending] = useState(0)
  const [meta, setMeta] = useState<SyncMeta>({
    lastBlockchainSyncBlock: '0',
    lastGovernmentSyncAt: '',
    lastSyncAt: '',
    offlineTileCacheSize: '0 MB',
  })
  const [queue, setQueue] = useState<any[]>([])
  const [syncing, setSyncing] = useState(false)
  const online = navigator.onLine

  async function refresh() {
    setPending(await getPendingQueueCount())
    setMeta(await getSyncMeta())
    setQueue(await listQueue())
  }

  useEffect(() => {
    refresh()
    const interval = window.setInterval(refresh, 10000)
    return () => window.clearInterval(interval)
  }, [])

  async function syncNow() {
    if (!online) {
      alert('Device is offline. Please connect to the internet to sync.')
      return
    }
    setSyncing(true)
    try {
      const result = await processQueue()
      await refresh()
      alert(`Sync completed. attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed}`)
    } catch (err) {
      console.error('Sync failed', err)
      alert('Sync failed. Please try again.')
    }
    setSyncing(false)
  }

  const syncedCount = queue.filter((item) => item.synced).length
  const syncProgress = queue.length > 0 ? Math.round((syncedCount / queue.length) * 100) : 100

  return (
    <div className="page-radial-bg min-h-screen py-12 text-on-surface">
      <div className="container-max">
      <div className="stitch-display-grid stitch-gap-20">
      <Card className="glass-panel rounded-2xl">
        <CardBody>
          <div className="chip">Sync status</div>
          <h1 className="stitch-mt-12 stitch-font-28 stitch-font-800">Monitor offline queue and sync health.</h1>
          <p className="stitch-mt-8 stitch-text-muted stitch-maxw-1100">Keep track of blockchain sync, government sync, and local outbox actions from one clean panel.</p>
        </CardBody>
      </Card>

      {!online && (
        <Alert variant="warning">Device is offline. Changes will sync when connection is restored.</Alert>
      )}

      <StatsGrid>
        {[
          { label: 'Pending actions', value: pending },
          { label: 'Cache size', value: meta.offlineTileCacheSize },
          { label: 'Last sync', value: meta.lastSyncAt ? new Date(meta.lastSyncAt).toLocaleString() : 'Never' },
          { label: 'Blockchain block', value: `#${meta.lastBlockchainSyncBlock}` },
        ].map((item) => (
          <StatCard key={item.label} label={item.label} value={item.value} />
        ))}
      </StatsGrid>

      <Card className="glass-panel rounded-2xl">
        <CardBody>
          <div className="stitch-display-flex stitch-justify-between stitch-items-center">
            <div>
              <div className="stitch-font-18 stitch-font-800">Sync progress</div>
              <div className="stitch-mt-6 stitch-text-muted">Queued items synced: {syncedCount} of {queue.length}</div>
            </div>
            <Badge>{syncProgress}% complete</Badge>
          </div>

          <div className="stitch-mt-12">
            <ProgressBar progress={syncProgress} />
          </div>
          <div className="stitch-mt-12 stitch-display-flex stitch-gap-8">
            <Button onClick={syncNow} disabled={syncing || pending === 0} variant="primary">{syncing ? 'Syncing...' : 'Sync now'}</Button>
            <Button onClick={refresh} variant="ghost">Refresh</Button>
          </div>
        </CardBody>
      </Card>

      <Card className="glass-panel rounded-2xl">
        <CardBody>
          <div className="stitch-font-18 stitch-font-800">Detailed sync information</div>
          <div className="stitch-mt-12 stitch-grid-auto-fit-220">
            <Card>
              <CardBody>
                <div className="stitch-text-12 stitch-text-muted">Government portal sync</div>
                <div className="stitch-mt-6 stitch-font-700">{meta.lastGovernmentSyncAt ? new Date(meta.lastGovernmentSyncAt).toLocaleString() : 'Not synced'}</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="stitch-text-12 stitch-text-muted">Connection status</div>
                <div className="stitch-mt-6"><Badge variant={online ? 'success' : 'error'}>{online ? 'Online' : 'Offline'}</Badge></div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="stitch-text-12 stitch-text-muted">Queue items</div>
                <div className="stitch-mt-6 stitch-font-700">{queue.length}</div>
              </CardBody>
            </Card>
          </div>
        </CardBody>
      </Card>

      <Card className="glass-panel rounded-2xl">
        <CardBody>
          <div className="stitch-font-18 stitch-font-800">Outbox queue</div>
          <div className="stitch-mt-12 stitch-display-grid stitch-gap-12">
            {queue.map((item) => (
              <Card key={item.id}>
                <CardBody>
                  <div className="stitch-display-flex stitch-justify-between stitch-items-center">
                    <div>
                      <div className="stitch-font-700">{item.type || item.action}</div>
                      <div className="stitch-mt-6 stitch-text-muted">{item.status} · {new Date(item.timestamp || item.createdAt).toLocaleString()}</div>
                    </div>
                    <Badge variant={item.synced ? 'success' : 'warning'}>{item.synced ? 'Synced' : 'Pending'}</Badge>
                  </div>
                </CardBody>
              </Card>
            ))}
            {queue.length === 0 && <div className="stitch-text-muted">No queued actions.</div>}
          </div>
        </CardBody>
      </Card>
      </div>
      </div>
    </div>
  )
}
