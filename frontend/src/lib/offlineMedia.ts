export type OfflineMediaMeta = {
  id: string
  filename: string
  mimeType: string
  capturedLat: number
  capturedLng: number
  capturedAt: string
  createdAt: string
}

type StoredMedia = OfflineMediaMeta & { blob: Blob }

const DB_NAME = 'roadwatch_offline_media'
const STORE = 'media'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
  })
}

export async function saveOfflineMedia(
  id: string,
  blob: Blob,
  meta: Omit<OfflineMediaMeta, 'id' | 'createdAt'>
): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const record: StoredMedia = {
      id,
      blob,
      createdAt: new Date().toISOString(),
      ...meta,
    }
    tx.objectStore(STORE).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('save offline media failed'))
  })
  db.close()
}

export async function getOfflineMedia(id: string): Promise<StoredMedia | null> {
  const db = await openDb()
  const record = await new Promise<StoredMedia | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(id)
    request.onsuccess = () => resolve((request.result as StoredMedia | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('read offline media failed'))
  })
  db.close()
  return record
}

export async function deleteOfflineMedia(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('delete offline media failed'))
  })
  db.close()
}
