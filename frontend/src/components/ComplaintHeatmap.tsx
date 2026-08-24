import { useEffect, useMemo, useRef, useState } from 'react';
import { computeDensityZones, createDensityZoneLayers, expandHeatmapAggregates, type MapPoint } from '../lib/mapDensityZones';
import { DELHI_CENTER, invalidateMapSoon } from '../lib/mapLocation';
import { getSeverityColor, getSeverityLabel } from '../lib/mapSeverity';
import MapLegend, { type LegendItem } from './MapLegend';

type ComplaintData = {
  id: string;
  lat: number;
  lng: number;
  severity: number;
  status: 'Open' | 'InProgress' | 'Resolved' | 'Dismissed';
  damageType: string;
  createdAt: string;
  title: string;
};

type HeatmapAggregate = {
  lat: number;
  lng: number;
  severity?: number;
  count?: number;
};

type HeatmapProps = {
  complaints: ComplaintData[];
  heatmapAggregates?: HeatmapAggregate[];
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: string;
  showControls?: boolean;
  showLegend?: boolean;
  showDensityOverlay?: boolean;
  legendPosition?: 'bottom-left' | 'bottom-right' | 'top-left';
  densityMinCount?: number;
  heatmapThreshold?: number;
  cityZoomThreshold?: number;
  onComplaintClick?: (complaint: ComplaintData) => void;
};

export default function ComplaintHeatmap({
  complaints,
  heatmapAggregates = [],
  center = DELHI_CENTER,
  zoom = 12,
  height = '500px',
  showControls = true,
  showLegend = true,
  showDensityOverlay = true,
  legendPosition = 'bottom-left',
  densityMinCount = 3,
  heatmapThreshold = 20,
  cityZoomThreshold = 11,
  onComplaintClick,
}: HeatmapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const heatLayerRef = useRef<any>(null);
  const densityHandleRef = useRef<{ remove: () => void } | null>(null);
  const markersRef = useRef<any[]>([]);

  const [viewMode, setViewMode] = useState<'heatmap' | 'markers' | 'both'>('both');
  const [severityFilter, setSeverityFilter] = useState<number[]>([1, 2, 3, 4, 5]);
  const [statusFilter, setStatusFilter] = useState<string[]>(['Open', 'InProgress']);
  const shouldForceHeatmap = complaints.length >= heatmapThreshold || zoom <= cityZoomThreshold;
  const effectiveViewMode = shouldForceHeatmap ? 'heatmap' : viewMode;

  const filteredComplaints = complaints.filter(
    (complaint) =>
      severityFilter.includes(complaint.severity) && statusFilter.includes(complaint.status),
  );

  const densityPoints = useMemo<MapPoint[]>(() => {
    const fromComplaints = filteredComplaints.map((c) => ({
      lat: c.lat,
      lng: c.lng,
      severity: c.severity,
    }));
    const fromAggregates = expandHeatmapAggregates(heatmapAggregates);
    return [...fromComplaints, ...fromAggregates];
  }, [filteredComplaints, heatmapAggregates]);

  const densityZones = useMemo(
    () =>
      showDensityOverlay
        ? computeDensityZones(densityPoints, { minCount: densityMinCount })
        : [],
    [densityPoints, densityMinCount, showDensityOverlay],
  );

  const legendItems = useMemo<LegendItem[]>(() => {
    const items: LegendItem[] = [
      ...[1, 2, 3, 4, 5].map((severity) => ({
        kind: 'swatch' as const,
        color: getSeverityColor(severity),
        label: `${getSeverityLabel(severity)} (${severity})`,
      })),
      {
        kind: 'gradient',
        title: 'Complaint density',
        stops: [
          { color: 'rgba(220, 38, 38, 0.12)', at: '0%', label: 'Few' },
          { color: 'rgba(220, 38, 38, 0.55)', at: '100%', label: 'Cluster' },
        ],
      },
    ];
    if (effectiveViewMode === 'heatmap' || effectiveViewMode === 'both') {
      items.push({
        kind: 'gradient',
        title: 'Heat intensity',
        stops: [
          { color: '#4575b4', at: '0%', label: 'Low' },
          { color: '#fee090', at: '50%' },
          { color: '#a50026', at: '100%', label: 'High' },
        ],
      });
    }
    if (densityZones.length > 0) {
      items.push({
        kind: 'note',
        label: 'Red zones',
        detail: `${densityZones.length} high-density region${densityZones.length === 1 ? '' : 's'}`,
      });
    }
    return items;
  }, [densityZones.length, effectiveViewMode]);

  useEffect(() => {
    const loadLeafletAndHeatmap = async () => {
      if (!document.querySelector('link[data-leaflet]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute('data-leaflet', '1');
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.crossOrigin = '';
        document.head.appendChild(link);
      }

      if (!(window as any).L) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Leaflet'));
          document.body.appendChild(script);
        });
      }

      if (!(window as any).L?.heatLayer) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Leaflet Heat'));
          document.body.appendChild(script);
        });
      }

      return (window as any).L;
    };

    let mounted = true;
    let clearInvalidate: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;

    loadLeafletAndHeatmap()
      .then((L) => {
        if (!mounted || !containerRef.current || mapRef.current) return;

        mapRef.current = L.map(containerRef.current).setView([center.lat, center.lng], zoom);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 18,
        }).addTo(mapRef.current);

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

        updateMapLayers(L);
      })
      .catch(console.error);

    return () => {
      mounted = false;
      clearInvalidate?.();
      resizeObserver?.disconnect();
      densityHandleRef.current?.remove();
      densityHandleRef.current = null;
      if (mapRef.current) {
        try {
          mapRef.current.remove();
          mapRef.current = null;
        } catch {
          /* ignore */
        }
      }
    };
  }, [center.lat, center.lng, zoom]);

  useEffect(() => {
    if (mapRef.current && (window as any).L) {
      updateMapLayers((window as any).L);
    }
  }, [filteredComplaints, effectiveViewMode, densityZones, showDensityOverlay]);

  const updateMapLayers = (L: any) => {
    if (heatLayerRef.current) {
      mapRef.current.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }
    densityHandleRef.current?.remove();
    densityHandleRef.current = null;
    markersRef.current.forEach((marker) => mapRef.current.removeLayer(marker));
    markersRef.current = [];

    if (showDensityOverlay && densityZones.length > 0) {
      densityHandleRef.current = createDensityZoneLayers(L, mapRef.current, densityZones);
    }

    if (filteredComplaints.length === 0) return;

    const heatmapData = filteredComplaints.map((complaint) => [
      complaint.lat,
      complaint.lng,
      complaint.severity / 5,
    ]);

    if (effectiveViewMode === 'heatmap' || effectiveViewMode === 'both') {
      heatLayerRef.current = L.heatLayer(heatmapData, {
        radius: 25,
        blur: 15,
        maxZoom: 17,
        gradient: {
          0.0: '#313695',
          0.1: '#4575b4',
          0.2: '#74add1',
          0.3: '#abd9e9',
          0.4: '#e0f3f8',
          0.5: '#ffffcc',
          0.6: '#fee090',
          0.7: '#fdae61',
          0.8: '#f46d43',
          0.9: '#d73027',
          1.0: '#a50026',
        },
      }).addTo(mapRef.current);
    }

    if (effectiveViewMode === 'markers' || effectiveViewMode === 'both') {
      filteredComplaints.forEach((complaint) => {
        const color = getSeverityColor(complaint.severity);
        const icon = L.divIcon({
          className: 'complaint-marker',
          html: `
            <div style="
              background-color: ${color};
              width: 20px;
              height: 20px;
              border-radius: 50%;
              border: 2px solid white;
              box-shadow: 0 2px 4px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 10px;
              font-weight: bold;
            ">${complaint.severity}</div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });

        const marker = L.marker([complaint.lat, complaint.lng], { icon })
          .bindPopup(
            `
            <div style="min-width: 200px;">
              <h4 style="margin: 0 0 8px 0; color: #002045;">${complaint.title}</h4>
              <p style="margin: 0 0 4px 0; font-size: 12px; color: #666;">
                <strong>Type:</strong> ${complaint.damageType}
              </p>
              <p style="margin: 0 0 4px 0; font-size: 12px; color: #666;">
                <strong>Severity:</strong> ${complaint.severity}/5
              </p>
              <p style="margin: 0 0 4px 0; font-size: 12px; color: #666;">
                <strong>Status:</strong> ${complaint.status}
              </p>
              <p style="margin: 0; font-size: 11px; color: #999;">
                ${new Date(complaint.createdAt).toLocaleDateString()}
              </p>
            </div>
          `,
          )
          .addTo(mapRef.current);

        if (onComplaintClick) {
          marker.on('click', () => onComplaintClick(complaint));
        }

        markersRef.current.push(marker);
      });
    }
  };

  return (
    <div className="relative h-full">
      <div
        ref={containerRef}
        className="w-full h-full rounded-lg overflow-hidden border border-gray-200"
        style={{ height, minHeight: height === '100%' ? 320 : undefined, background: '#e8eef5' }}
      />

      {showLegend && (
        <MapLegend
          title="Complaint map"
          items={legendItems}
          position={legendPosition}
          compact={height !== '100%' && parseInt(height, 10) < 400}
        />
      )}

      {showControls && (
        <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-4 max-w-xs z-[1000]">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">View Mode</label>
            <select
              value={effectiveViewMode}
              onChange={(e) => setViewMode(e.target.value as 'heatmap' | 'markers' | 'both')}
              disabled={shouldForceHeatmap}
              className="w-full px-3 py-1 border border-gray-300 rounded text-sm"
            >
              <option value="both">Heatmap + Markers</option>
              <option value="heatmap">Heatmap Only</option>
              <option value="markers">Markers Only</option>
            </select>
            {shouldForceHeatmap && (
              <p className="mt-2 text-[11px] text-gray-500 leading-snug">
                Heatmap mode is enabled automatically for broader regional views.
              </p>
            )}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Severity Levels</label>
            <div className="space-y-1">
              {[1, 2, 3, 4, 5].map((severity) => (
                <label key={severity} className="flex items-center text-xs">
                  <input
                    type="checkbox"
                    checked={severityFilter.includes(severity)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSeverityFilter([...severityFilter, severity]);
                      } else {
                        setSeverityFilter(severityFilter.filter((s) => s !== severity));
                      }
                    }}
                    className="mr-2"
                  />
                  <div
                    className="w-3 h-3 rounded-full mr-2"
                    style={{ backgroundColor: getSeverityColor(severity) }}
                  />
                  {getSeverityLabel(severity)}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <div className="space-y-1">
              {['Open', 'InProgress', 'Resolved', 'Dismissed'].map((status) => (
                <label key={status} className="flex items-center text-xs">
                  <input
                    type="checkbox"
                    checked={statusFilter.includes(status)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setStatusFilter([...statusFilter, status]);
                      } else {
                        setStatusFilter(statusFilter.filter((s) => s !== status));
                      }
                    }}
                    className="mr-2"
                  />
                  {status}
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 space-y-1">
            <div className="text-xs text-gray-600">
              Showing {filteredComplaints.length} of {complaints.length} complaints
            </div>
            {densityZones.length > 0 && (
              <div className="text-xs text-red-700 font-medium">
                {densityZones.length} high-density zone{densityZones.length === 1 ? '' : 's'} highlighted
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
