import { DELHI_CENTER } from './mapLocation'

export type GeoCapture = {
  lat: number
  lng: number
  capturedAt: string
  accuracyM?: number
}

const DEFAULT_FALLBACK: GeoCapture = {
  lat: DELHI_CENTER.lat,
  lng: DELHI_CENTER.lng,
  capturedAt: new Date().toISOString(),
}

export async function captureGeoPosition(timeoutMs = 8000): Promise<GeoCapture> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { ...DEFAULT_FALLBACK, capturedAt: new Date().toISOString() }
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          capturedAt: new Date().toISOString(),
          accuracyM: pos.coords.accuracy,
        })
      },
      () => resolve({ ...DEFAULT_FALLBACK, capturedAt: new Date().toISOString() }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    )
  })
}

export function formatCoords(lat: number, lng: number) {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`
}
