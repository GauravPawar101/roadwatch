import { useEffect, useMemo, useRef } from 'react';
import { computeDensityZones, createDensityZoneLayers, type MapPoint } from '../lib/mapDensityZones';
import { DELHI_CENTER, invalidateMapSoon } from '../lib/mapLocation';
import MapLegend, { type LegendItem } from './MapLegend';

type Marker = { lat: number; lng: number; label?: string; href?: string };

export default function MapEmbed({
  center = DELHI_CENTER,
  zoom = 10,
  markers = [],
  densityPoints = [],
  height = '300px',
  showLegend = false,
  legendPosition = 'bottom-left',
  densityMinCount = 3,
}: {
  center?: { lat: number; lng: number };
  zoom?: number;
  markers?: Marker[];
  /** Optional complaint coordinates used to draw red density overlays. */
  densityPoints?: MapPoint[];
  height?: string;
  showLegend?: boolean;
  legendPosition?: 'bottom-left' | 'bottom-right' | 'top-left';
  densityMinCount?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const densityHandleRef = useRef<{ remove: () => void } | null>(null);

  const densityZones = useMemo(
    () => (densityPoints.length > 0 ? computeDensityZones(densityPoints, { minCount: densityMinCount }) : []),
    [densityPoints, densityMinCount],
  );

  const legendItems = useMemo<LegendItem[]>(
    () => [
      { kind: 'swatch', color: '#2563eb', label: 'Location marker' },
      {
        kind: 'gradient',
        title: 'Complaint density',
        stops: [
          { color: 'rgba(220, 38, 38, 0.12)', at: '0%', label: 'Few' },
          { color: 'rgba(220, 38, 38, 0.55)', at: '100%', label: 'Cluster' },
        ],
      },
      ...(densityZones.length > 0
        ? [
            {
              kind: 'note' as const,
              label: 'Red zones',
              detail: `${densityZones.length} congested area${densityZones.length === 1 ? '' : 's'}`,
            },
          ]
        : []),
    ],
    [densityZones.length],
  );

  useEffect(() => {
    const loadCss = () => {
      if (document.querySelector('link[data-leaflet]')) return Promise.resolve();
      return new Promise<void>((res) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute('data-leaflet', '1');
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.crossOrigin = '';
        link.onload = () => res();
        document.head.appendChild(link);
      });
    };

    const loadScript = () => {
      if ((window as any).L) return Promise.resolve();
      return new Promise<void>((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        s.async = true;
        s.defer = true;
        s.onload = () => res();
        s.onerror = () => rej(new Error('Failed to load Leaflet'));
        document.body.appendChild(s);
      });
    };

    let mounted = true;
    let clearInvalidate: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;

    const renderMap = () => {
      if (!mounted || !containerRef.current) return;
      const L = (window as any).L;
      try {
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }
        densityHandleRef.current?.remove();
        densityHandleRef.current = null;

        mapRef.current = L.map(containerRef.current).setView([center.lat, center.lng], zoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(mapRef.current);

        if (densityZones.length > 0) {
          densityHandleRef.current = createDensityZoneLayers(L, mapRef.current, densityZones);
        }

        markers.forEach((m) => {
          const marker = L.marker([m.lat, m.lng]).addTo(mapRef.current);
          if (m.label) marker.bindPopup(m.label);
          if (m.href) marker.on('click', () => (window.location.href = m.href!));
        });

        clearInvalidate = invalidateMapSoon(mapRef.current);
        if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
          resizeObserver = new ResizeObserver(() => {
            try {
              mapRef.current?.invalidateSize?.();
            } catch {
              /* ignore */
            }
          });
          resizeObserver.observe(containerRef.current);
        }
      } catch (err) {
        console.error('Map init failed', err);
      }
    };

    loadCss()
      .then(loadScript)
      .then(renderMap);

    return () => {
      mounted = false;
      clearInvalidate?.();
      resizeObserver?.disconnect();
      densityHandleRef.current?.remove();
      densityHandleRef.current = null;
      try {
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }
      } catch {
        /* ignore */
      }
    };
  }, [center.lat, center.lng, zoom, JSON.stringify(markers), densityZones]);

  const shouldShowLegend = showLegend || densityZones.length > 0;

  return (
    <div className="relative stitch-w-100p">
      <div
        ref={containerRef}
        className="stitch-w-100p stitch-rounded-12 stitch-overflow-hidden"
        style={{ height, minHeight: height === '100%' ? 280 : undefined, background: '#e8eef5' }}
      />
      {shouldShowLegend && (
        <MapLegend
          title="Map legend"
          items={legendItems}
          position={legendPosition}
          compact
        />
      )}
    </div>
  );
}
