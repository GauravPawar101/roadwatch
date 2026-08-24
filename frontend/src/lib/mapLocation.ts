/** Delhi India Gate area — default when geolocation is unavailable. */
export const DELHI_CENTER = { lat: 28.6139, lng: 77.209 } as const

export type MapCenter = { lat: number; lng: number }

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  const la = Number(lat)
  const ln = Number(lng)
  return Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180
}

/** Prefer browser geolocation; fall back to Delhi. */
export function resolveMapCenter(timeoutMs = 6000): Promise<MapCenter> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ...DELHI_CENTER })
  }

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({ ...DELHI_CENTER }), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer)
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        resolve(isValidLatLng(lat, lng) ? { lat, lng } : { ...DELHI_CENTER })
      },
      () => {
        window.clearTimeout(timer)
        resolve({ ...DELHI_CENTER })
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 }
    )
  })
}

/** Call after Leaflet map create so tiles paint when the container was 0×0 at init. */
export function invalidateMapSoon(map: { invalidateSize?: () => void } | null | undefined, delays = [0, 100, 300, 800]) {
  if (!map?.invalidateSize) return () => {}
  const ids = delays.map((ms) => window.setTimeout(() => {
    try {
      map.invalidateSize?.()
    } catch {
      /* ignore */
    }
  }, ms))
  return () => ids.forEach((id) => window.clearTimeout(id))
}
