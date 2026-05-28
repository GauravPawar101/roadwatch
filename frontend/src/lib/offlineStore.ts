import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

type SqlJsDatabase = {
  run: (sql: string, params?: Array<string | number | null>) => void
  exec: (sql: string) => Array<{ values: Array<Array<string | number | null>> }>
  export: () => Uint8Array
}

type SqlJsModule = {
  Database: new (data?: Uint8Array) => SqlJsDatabase
}

const DB_KEY = 'roadwatch_sqlite_db'
const SQL_META_KEY = 'roadwatch_sqlite_meta'

const defaultMeta = {
  lastBlockchainSyncBlock: '0',
  lastGovernmentSyncAt: '',
  lastSyncAt: '',
  offlineTileCacheSize: '0 MB',
}

let dbPromise: Promise<SqlJsDatabase> | null = null

function toBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function fromBase64(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function persistDatabase(db: SqlJsDatabase) {
  const serialized = db.export()
  localStorage.setItem(DB_KEY, toBase64(serialized))
}

function loadMeta() {
  return { ...defaultMeta, ...(JSON.parse(localStorage.getItem(SQL_META_KEY) || '{}') as Record<string, string>) }
}

function escapeSql(value: string) {
  return value.replace(/'/g, "''")
}

function saveMeta(meta: Record<string, string>) {
  localStorage.setItem(SQL_META_KEY, JSON.stringify(meta))
}

async function openDatabase() {
  const SQL = (await initSqlJs({ locateFile: () => wasmUrl })) as unknown as SqlJsModule
  const saved = localStorage.getItem(DB_KEY)
  const db = saved ? new SQL.Database(fromBase64(saved)) : new SQL.Database()
  db.run(`
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      createdAt TEXT NOT NULL,
      syncedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  const meta = loadMeta()
  Object.entries(meta).forEach(([key, value]) => {
    db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', [key, value])
  })
  persistDatabase(db)
  return db
}

export async function getDb() {
  if (!dbPromise) {
    dbPromise = openDatabase()
  }
  return dbPromise
}

export async function saveRecord<T extends Record<string, unknown>>(collection: string, id: string, payload: T) {
  const db = await getDb()
  const now = new Date().toISOString()
  db.run('INSERT OR REPLACE INTO records (collection, id, payload, createdAt, updatedAt) VALUES (?, ?, ?, COALESCE((SELECT createdAt FROM records WHERE collection = ? AND id = ?), ?), ?)', [collection, id, JSON.stringify(payload), collection, id, now, now])
  persistDatabase(db)
}

export async function getRecord<T>(collection: string, id: string) {
  const db = await getDb()
  const result = db.exec(`SELECT payload FROM records WHERE collection = '${escapeSql(collection)}' AND id = '${escapeSql(id)}'`)
  const payload = result[0]?.values?.[0]?.[0]
  return payload ? (JSON.parse(String(payload)) as T) : null
}

export async function listRecords<T>(collection: string) {
  const db = await getDb()
  const result = db.exec(`SELECT payload FROM records WHERE collection = '${escapeSql(collection)}' ORDER BY updatedAt DESC`)
  const rows = result[0]?.values ?? []
  return rows.map((row) => JSON.parse(String(row[0])) as T)
}

export async function enqueueAction(action: string, payload: unknown) {
  const db = await getDb()
  db.run('INSERT INTO queue (action, payload, status, createdAt) VALUES (?, ?, ?, ?)', [action, JSON.stringify(payload), 'pending', new Date().toISOString()])
  persistDatabase(db)
}

export async function listQueue() {
  const db = await getDb()
  const result = db.exec('SELECT id, action, payload, status, createdAt, syncedAt FROM queue ORDER BY id DESC')
  const rows = result[0]?.values ?? []
  return rows.map((row) => ({
    id: Number(row[0]),
    action: String(row[1]),
    payload: JSON.parse(String(row[2])),
    status: String(row[3]),
    createdAt: String(row[4]),
    syncedAt: row[5] ? String(row[5]) : '',
  }))
}

export async function getPendingQueueItems() {
  const db = await getDb()
  const result = db.exec("SELECT id, action, payload, status, createdAt FROM queue WHERE status = 'pending' ORDER BY id ASC")
  const rows = result[0]?.values ?? []
  return rows.map((row) => ({
    id: Number(row[0]),
    action: String(row[1]),
    payload: JSON.parse(String(row[2])),
    status: String(row[3]),
    createdAt: String(row[4])
  }))
}

export async function markQueueItemSynced(id: number) {
  const db = await getDb()
  const now = new Date().toISOString()
  db.run('UPDATE queue SET status = ?, syncedAt = ? WHERE id = ?', ['synced', now, id])
  persistDatabase(db)
}

/**
 * Process pending outbox queue items and attempt to send them to the gateway API.
 * Currently implements `submit-complaint` action.
 * Returns an object with counts: { attempted, succeeded, failed }
 */
export async function processQueue(apiBase?: string) {
  const base = apiBase || (window as any).ENV?.VITE_API_BASE || 'http://localhost:3100'
  const pending = await getPendingQueueItems()
  let attempted = 0
  let succeeded = 0
  let failed = 0

  const token = localStorage.getItem('roadwatch_token')

  for (const item of pending) {
    attempted += 1
    try {
      if (item.action === 'submit-complaint') {
        const p = item.payload as any
        const body: any = {
          roadId: p.roadId,
          description: p.description,
          lat: p.location?.lat ?? p.lat,
          lng: p.location?.lng ?? p.lng,
          capturedLat: p.capturedLat ?? undefined,
          capturedLng: p.capturedLng ?? undefined,
          capturedAt: p.capturedAt ?? undefined,
          imageCid: p.imageCid ?? undefined,
          imageSha256: p.imageSha256 ?? undefined
        }

        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (token) headers['Authorization'] = `Bearer ${token}`

        const resp = await fetch(`${base}/citizen/complaints`, { method: 'POST', headers, body: JSON.stringify(body) })
        if (!resp.ok) {
          console.warn('[offline] submit-complaint failed', await resp.text())
          failed += 1
          continue
        }

        // mark item synced
        await markQueueItemSynced(item.id)
        succeeded += 1
        continue
      }

      // Unknown action: mark as failed for now
      console.warn('[offline] unknown queue action:', item.action)
      failed += 1
    } catch (err) {
      console.error('[offline] processing queue item failed', err)
      failed += 1
    }
  }

  return { attempted, succeeded, failed }
}

export async function getPendingQueueCount() {
  const db = await getDb()
  const result = db.exec("SELECT COUNT(*) FROM queue WHERE status = 'pending'")
  return Number(result[0]?.values?.[0]?.[0] ?? 0)
}

export async function markQueueSynced(blockNumber?: string) {
  const db = await getDb()
  const now = new Date().toISOString()
  db.run("UPDATE queue SET status = 'synced', syncedAt = ? WHERE status = 'pending'", [now])
  const meta = loadMeta()
  meta.lastBlockchainSyncBlock = blockNumber || String(Number(meta.lastBlockchainSyncBlock || '0') + 1)
  meta.lastGovernmentSyncAt = now
  meta.lastSyncAt = now
  saveMeta(meta)
  db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['lastBlockchainSyncBlock', meta.lastBlockchainSyncBlock])
  db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['lastGovernmentSyncAt', meta.lastGovernmentSyncAt])
  db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['lastSyncAt', meta.lastSyncAt])
  persistDatabase(db)
}

export async function getSyncMeta() {
  const db = await getDb()
  const result = db.exec('SELECT key, value FROM metadata')
  const rows = result[0]?.values ?? []
  const meta = { ...defaultMeta }
  rows.forEach((row) => {
    meta[String(row[0]) as keyof typeof meta] = String(row[1])
  })
  return meta
}

export async function updateSyncMeta(partial: Partial<typeof defaultMeta>) {
  const meta = { ...(await getSyncMeta()), ...partial }
  const db = await getDb()
  Object.entries(meta).forEach(([key, value]) => {
    db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', [key, value])
  })
  saveMeta(meta)
  persistDatabase(db)
}
