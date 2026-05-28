import { useEffect, useRef } from 'react';

type Marker = { lat: number; lng: number; label?: string; href?: string }

export default function MapEmbed({
  center = { lat: 19.076, lng: 72.8777 },
  zoom = 10,
  markers = [],
  height = '300px',
}: {
  center?: { lat: number; lng: number }
  zoom?: number
  markers?: Marker[]
  height?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)

  useEffect(() => {
    // load leaflet CSS & JS from CDN if necessary
    const loadCss = () => {
      if (document.querySelector('link[data-leaflet]')) return Promise.resolve()
      return new Promise<void>((res) => {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.setAttribute('data-leaflet', '1')
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        link.crossOrigin = ''
        link.onload = () => res()
        document.head.appendChild(link)
      })
    }

    const loadScript = () => {
      if ((window as any).L) return Promise.resolve()
      return new Promise<void>((res, rej) => {
        const s = document.createElement('script')
        s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
        s.async = true
        s.defer = true
        s.onload = () => res()
        s.onerror = () => rej(new Error('Failed to load Leaflet'))
        document.body.appendChild(s)
      })
    }

    let mounted = true
    loadCss()
      .then(loadScript)
      .then(() => {
        if (!mounted || !containerRef.current) return
        const L = (window as any).L
        try {
          mapRef.current = L.map(containerRef.current).setView([center.lat, center.lng], zoom)
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
          }).addTo(mapRef.current)

          // add markers
          markers.forEach((m) => {
            const marker = L.marker([m.lat, m.lng]).addTo(mapRef.current)
            const label = m.label
            if (label) marker.bindPopup(label)
            const href = m.href
            if (href) marker.on('click', () => (window.location.href = href))
          })
        } catch (err) {
          // ignore runtime errors (e.g., SSR or permission issues)
          // eslint-disable-next-line no-console
          console.error('Map init failed', err)
        }
      })

    return () => {
      mounted = false
      try {
        if (mapRef.current) {
          mapRef.current.remove()
          mapRef.current = null
        }
      } catch (e) {
        // ignore
      }
    }
  }, [center.lat, center.lng, zoom, JSON.stringify(markers)])

  return <div ref={containerRef} className="stitch-w-100p stitch-rounded-12 stitch-overflow-hidden" style={{ height }} />
}
