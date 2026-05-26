import { useEffect, useRef, useState } from 'react';

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

type HeatmapProps = {
  complaints: ComplaintData[];
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: string;
  showControls?: boolean;
  heatmapThreshold?: number;
  cityZoomThreshold?: number;
  onComplaintClick?: (complaint: ComplaintData) => void;
};

export default function ComplaintHeatmap({
  complaints,
  center = { lat: 19.076, lng: 72.8777 },
  zoom = 12,
  height = '500px',
  showControls = true,
  heatmapThreshold = 20,
  cityZoomThreshold = 11,
  onComplaintClick
}: HeatmapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const heatLayerRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  
  const [viewMode, setViewMode] = useState<'heatmap' | 'markers' | 'both'>('both');
  const [severityFilter, setSeverityFilter] = useState<number[]>([1, 2, 3, 4, 5]);
  const [statusFilter, setStatusFilter] = useState<string[]>(['Open', 'InProgress']);
  const shouldForceHeatmap = complaints.length >= heatmapThreshold || zoom <= cityZoomThreshold;
  const effectiveViewMode = shouldForceHeatmap ? 'heatmap' : viewMode;

  // Filter complaints based on current filters
  const filteredComplaints = complaints.filter(complaint => 
    severityFilter.includes(complaint.severity) &&
    statusFilter.includes(complaint.status)
  );

  useEffect(() => {
    const loadLeafletAndHeatmap = async () => {
      // Load Leaflet CSS
      if (!document.querySelector('link[data-leaflet]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute('data-leaflet', '1');
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.crossOrigin = '';
        document.head.appendChild(link);
      }

      // Load Leaflet JS
      if (!(window as any).L) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Leaflet'));
          document.body.appendChild(script);
        });
      }

      // Load Leaflet Heatmap plugin
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

    loadLeafletAndHeatmap()
      .then((L) => {
        if (!mounted || !containerRef.current || mapRef.current) return;

        // Initialize map
        mapRef.current = L.map(containerRef.current).setView([center.lat, center.lng], zoom);
        
        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 18
        }).addTo(mapRef.current);

        updateMapLayers(L);
      })
      .catch(console.error);

    return () => {
      mounted = false;
      if (mapRef.current) {
        try {
          mapRef.current.remove();
          mapRef.current = null;
        } catch (e) {
          // ignore cleanup errors
        }
      }
    };
  }, [center.lat, center.lng, zoom]);

  // Update map layers when complaints or filters change
  useEffect(() => {
    if (mapRef.current && (window as any).L) {
      updateMapLayers((window as any).L);
    }
  }, [filteredComplaints, effectiveViewMode]);

  const updateMapLayers = (L: any) => {
    // Clear existing layers
    if (heatLayerRef.current) {
      mapRef.current.removeLayer(heatLayerRef.current);
    }
    markersRef.current.forEach(marker => mapRef.current.removeLayer(marker));
    markersRef.current = [];

    if (filteredComplaints.length === 0) return;

    // Create heatmap data
    const heatmapData = filteredComplaints.map(complaint => [
      complaint.lat,
      complaint.lng,
      complaint.severity / 5 // Normalize severity to 0-1
    ]);

    // Add heatmap layer
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
          1.0: '#a50026'
        }
      }).addTo(mapRef.current);
    }

    // Add markers
    if (effectiveViewMode === 'markers' || effectiveViewMode === 'both') {
      filteredComplaints.forEach(complaint => {
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
          iconAnchor: [12, 12]
        });

        const marker = L.marker([complaint.lat, complaint.lng], { icon })
          .bindPopup(`
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
          `)
          .addTo(mapRef.current);

        if (onComplaintClick) {
          marker.on('click', () => onComplaintClick(complaint));
        }

        markersRef.current.push(marker);
      });
    }
  };

  const getSeverityColor = (severity: number): string => {
    const colors = {
      1: '#4CAF50', // Green - Low
      2: '#8BC34A', // Light Green - Low-Medium  
      3: '#FF9800', // Orange - Medium
      4: '#FF5722', // Deep Orange - High
      5: '#F44336'  // Red - Critical
    };
    return colors[severity as keyof typeof colors] || '#666';
  };

  const getSeverityLabel = (severity: number): string => {
    const labels = {
      1: 'Low',
      2: 'Low-Medium',
      3: 'Medium', 
      4: 'High',
      5: 'Critical'
    };
    return labels[severity as keyof typeof labels] || 'Unknown';
  };

  return (
    <div className="relative">
      {/* Map Container */}
      <div 
        ref={containerRef} 
        className="w-full rounded-lg overflow-hidden border border-gray-200"
        style={{ height }}
      />

      {/* Controls */}
      {showControls && (
        <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-4 max-w-xs">
          {/* View Mode Toggle */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              View Mode
            </label>
            <select
              value={effectiveViewMode}
              onChange={(e) => setViewMode(e.target.value as any)}
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

          {/* Severity Filter */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Severity Levels
            </label>
            <div className="space-y-1">
              {[1, 2, 3, 4, 5].map(severity => (
                <label key={severity} className="flex items-center text-xs">
                  <input
                    type="checkbox"
                    checked={severityFilter.includes(severity)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSeverityFilter([...severityFilter, severity]);
                      } else {
                        setSeverityFilter(severityFilter.filter(s => s !== severity));
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

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Status
            </label>
            <div className="space-y-1">
              {['Open', 'InProgress', 'Resolved', 'Dismissed'].map(status => (
                <label key={status} className="flex items-center text-xs">
                  <input
                    type="checkbox"
                    checked={statusFilter.includes(status)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setStatusFilter([...statusFilter, status]);
                      } else {
                        setStatusFilter(statusFilter.filter(s => s !== status));
                      }
                    }}
                    className="mr-2"
                  />
                  {status}
                </label>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="text-xs text-gray-600">
              Showing {filteredComplaints.length} of {complaints.length} complaints
            </div>
          </div>
        </div>
      )}
    </div>
  );
}