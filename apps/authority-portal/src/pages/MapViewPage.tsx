import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import {
    createCitizenComplaint,
    getRoadSegmentsGeoJson,
    listComplaints,
    type Complaint,
    type RoadSegmentsGeoJson
} from '../api';
import { getToken, getUser } from '../auth';

const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

function CaptureMap({ onReady }: { onReady: (map: any) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

function CaptureCenter({ onCenter }: { onCenter: (center: { lat: number; lng: number }) => void }) {
  const map = useMapEvents({
    moveend() {
      const c = map.getCenter();
      onCenter({ lat: c.lat, lng: c.lng });
    }
  });

  useEffect(() => {
    const c = map.getCenter();
    onCenter({ lat: c.lat, lng: c.lng });
  }, [map, onCenter]);

  return null;
}

function hashHue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

function toRad(v: number) {
  return (v * Math.PI) / 180;
}

function distancePointToLineMeters(point: { lat: number; lng: number }, line: Array<[number, number]>): number {
  const R = 6371000;
  const lat0 = toRad(point.lat);
  const cos0 = Math.cos(lat0);

  const xy = (coord: [number, number]) => {
    const [lng, lat] = coord;
    return {
      x: toRad(lng - point.lng) * R * cos0,
      y: toRad(lat - point.lat) * R
    };
  };

  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length - 1; i++) {
    const a = xy(line[i]!);
    const b = xy(line[i + 1]!);
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;

    let t = 0;
    if (len2 > 0) {
      t = (-(a.x * vx + a.y * vy)) / len2;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
    }

    const cx = a.x + t * vx;
    const cy = a.y + t * vy;
    const d = Math.sqrt(cx * cx + cy * cy);
    if (d < best) best = d;
  }
  return best;
}

function minDistanceToGeometryMeters(point: { lat: number; lng: number }, geometry: any): number {
  if (!geometry || typeof geometry !== 'object') return Number.POSITIVE_INFINITY;
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return distancePointToLineMeters(point, geometry.coordinates as Array<[number, number]>);
  }
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    let best = Number.POSITIVE_INFINITY;
    for (const line of geometry.coordinates as Array<Array<[number, number]>>) {
      const d = distancePointToLineMeters(point, line);
      if (d < best) best = d;
    }
    return best;
  }
  return Number.POSITIVE_INFINITY;
}

export function MapViewPage() {
  const token = getToken();
  const user = getUser<any>();

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [locating, setLocating] = useState(false);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number; accuracyM?: number } | null>(null);
  const [map, setMap] = useState<any>(null);

  const [roads, setRoads] = useState<RoadSegmentsGeoJson | null>(null);
  const [roadsLoading, setRoadsLoading] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);

  const [selectedRoadId, setSelectedRoadId] = useState<string | null>(null);
  const [selectedDistanceM, setSelectedDistanceM] = useState<number | null>(null);

  const [complaintText, setComplaintText] = useState('');
  const [complaintImage, setComplaintImage] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const roadsLayerRef = useRef<any>(null);

  useEffect(() => {
    if (!token) return;
    listComplaints(token)
      .then(setComplaints)
      .catch((e: any) => setError(e?.message ?? 'Failed'));
  }, [token]);

  useEffect(() => {
    if (!mapCenter) return;
    const ac = new AbortController();
    setRoadsLoading(true);
    setError(null);

    getRoadSegmentsGeoJson({ lat: mapCenter.lat, lng: mapCenter.lng, limit: 8000 })
      .then((geo) => {
        if (!ac.signal.aborted) setRoads(geo);
      })
      .catch((e: any) => {
        if (!ac.signal.aborted) setError(e?.message ?? 'Failed to load road segments');
      })
      .finally(() => {
        if (!ac.signal.aborted) setRoadsLoading(false);
      });

    return () => ac.abort();
  }, [mapCenter?.lat, mapCenter?.lng]);

  const points = complaints.filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number');
  const initialCenter: [number, number] = points.length
    ? [points[0]!.lat as number, points[0]!.lng as number]
    : [22.9734, 78.6569];

  const nearest = useMemo(() => {
    if (!myLocation || !points.length) return null;

    const distM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const R = 6371000;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const sLat1 = toRad(a.lat);
      const sLat2 = toRad(b.lat);
      const h =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(sLat1) * Math.cos(sLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    };

    let best: { complaint: Complaint; distanceM: number } | null = null;
    for (const c of points) {
      const d = distM(myLocation, { lat: c.lat as number, lng: c.lng as number });
      if (!best || d < best.distanceM) best = { complaint: c, distanceM: d };
    }
    return best;
  }, [myLocation, points]);

  const selectedFeature = useMemo(() => {
    if (!roads || !selectedRoadId) return null;
    return roads.features.find((x) => x.properties?.roadId === selectedRoadId) ?? null;
  }, [roads, selectedRoadId]);

  const canSubmitComplaint =
    !!token &&
    user?.role === 'CITIZEN' &&
    !!myLocation &&
    selectedDistanceM != null &&
    selectedDistanceM <= 100 &&
    complaintText.trim().length >= 5 &&
    !submitting;

  return (
    <>
      <h2>Map View</h2>
      {error ? <div style={{ margin: '10px 0', color: '#b91c1c' }}>{error}</div> : null}
      <p className="muted">Hover road segments for info; click a road to select. Use your location to validate the 100m rule.</p>

      <div className="row" style={{ alignItems: 'stretch' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden', flex: 2, minWidth: 420 }}>
          <MapContainer center={initialCenter} zoom={5} style={{ height: 520, width: '100%' }}>
            <CaptureMap onReady={setMap as any} />
            <CaptureCenter onCenter={setMapCenter} />
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

            {roads ? (
              <GeoJSON
                key={`roads-${selectedRoadId ?? ''}`}
                ref={roadsLayerRef as any}
                data={roads as any}
                style={(feature: any) => {
                  const props = feature?.properties as any;
                  const assignment = props?.assignment;

                  const keyText =
                    assignment?.contractorId ||
                    assignment?.engineerUserId ||
                    props?.authorityId ||
                    props?.roadId ||
                    'road';
                  const hue = hashHue(String(keyText));
                  const color = `hsl(${hue} 70% 45%)`;

                  const now = Date.now();
                  const start = assignment?.startsOn ? Date.parse(assignment.startsOn) : null;
                  const end = assignment?.endsOn ? Date.parse(assignment.endsOn) : null;
                  const active = (!start || now >= start) && (!end || now <= end);

                  const selected = props?.roadId && selectedRoadId && props.roadId === selectedRoadId;

                  return {
                    color,
                    weight: selected ? 7 : 4,
                    opacity: active ? 0.85 : 0.45,
                    dashArray: active ? undefined : '6 8'
                  } as any;
                }}
                onEachFeature={(feature: any, layer: any) => {
                  const props = feature?.properties as any;
                  const a = props?.assignment;
                  const auth = props?.authority;

                  const title = props?.name ? String(props.name) : String(props?.roadId ?? 'Road');
                  const contractor = a?.contractorName ? `Contractor: ${a.contractorName}` : 'Contractor: —';
                  const engineer = a?.engineerGovtId ? `Engineer ID: ${a.engineerGovtId}` : 'Engineer ID: —';
                  const period = a?.startsOn || a?.endsOn ? `Period: ${a?.startsOn ?? '—'} → ${a?.endsOn ?? '—'}` : 'Period: —';
                  const dept = auth?.name ? `Dept: ${auth.name}` : `Dept: ${props?.authorityId ?? '—'}`;

                  layer.bindTooltip(
                    `<div style="font-weight:600">${title}</div><div style="font-size:12px">${contractor}<br/>${engineer}<br/>${period}<br/>${dept}</div>`,
                    { sticky: true }
                  );

                  layer.on('click', () => {
                    setSelectedRoadId(String(props?.roadId ?? ''));
                    if (myLocation) {
                      const d = minDistanceToGeometryMeters(myLocation, feature.geometry);
                      setSelectedDistanceM(Number.isFinite(d) ? d : null);
                      if (Number.isFinite(d) && d > 100) {
                        setError(`You are ~${Math.round(d)}m from this road (need ≤100m).`);
                      } else {
                        setError(null);
                      }
                    } else {
                      setSelectedDistanceM(null);
                    }
                    setSubmittedId(null);
                  });
                }}
              />
            ) : null}

            {myLocation ? (
              <>
                <CircleMarker
                  center={[myLocation.lat, myLocation.lng]}
                  radius={24}
                  pathOptions={{ color: '#111827', weight: 3, fillOpacity: 0 }}
                  className="rw-location-ring"
                />
                <Marker position={[myLocation.lat, myLocation.lng]} icon={markerIcon}>
                  <Popup>
                    <div style={{ fontWeight: 600 }}>You are here</div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {myLocation.lat.toFixed(5)}, {myLocation.lng.toFixed(5)}
                    </div>
                    {nearest ? (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 600 }}>Nearest issue</div>
                        <div className="muted" style={{ marginTop: 4 }}>
                          {nearest.complaint.id} — {nearest.complaint.district} / {nearest.complaint.zone}
                        </div>
                        <div className="muted" style={{ marginTop: 2 }}>~{Math.round(nearest.distanceM)}m away</div>
                      </div>
                    ) : null}
                  </Popup>
                </Marker>
              </>
            ) : null}

            {points.map((c) => (
              <Marker key={c.id} position={[c.lat as number, c.lng as number]} icon={markerIcon}>
                <Popup>
                  <div style={{ fontWeight: 600 }}>{c.id}</div>
                  <div>{c.description}</div>
                  <div className="muted">
                    {c.district} / {c.zone} — {c.status}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        <div className="card" style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontWeight: 700 }}>Controls</div>
          <div className="muted" style={{ marginTop: 6 }}>
            {roadsLoading ? 'Loading road segments…' : `Segments: ${roads?.features?.length ?? 0}`}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
            <button
              className="secondary"
              disabled={locating}
              onClick={async () => {
                if (!('geolocation' in navigator)) {
                  setError('Geolocation not supported in this browser');
                  return;
                }
                setLocating(true);
                setError(null);
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy };
                    setMyLocation(next);
                    if (map) map.setView([next.lat, next.lng], 16);
                    setLocating(false);
                  },
                  (e) => {
                    setError(e?.message ?? 'Failed to fetch location');
                    setLocating(false);
                  },
                  { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
                );
              }}
            >
              {locating ? 'Locating…' : 'Use my location'}
            </button>

            <button
              className="secondary"
              disabled={!myLocation || !roads?.features?.length}
              onClick={() => {
                if (!myLocation || !roads?.features?.length) return;
                let best: { roadId: string; distanceM: number } | null = null;
                for (const f of roads.features) {
                  const roadId = f.properties?.roadId;
                  if (!roadId) continue;
                  const d = minDistanceToGeometryMeters(myLocation, f.geometry);
                  if (!Number.isFinite(d)) continue;
                  if (!best || d < best.distanceM) best = { roadId, distanceM: d };
                }
                if (!best) {
                  setError('No road geometries available in this view');
                  return;
                }
                setSelectedRoadId(best.roadId);
                setSelectedDistanceM(best.distanceM);
                setError(best.distanceM > 100 ? `Nearest road is ~${Math.round(best.distanceM)}m away (need ≤100m).` : null);
              }}
            >
              Mark nearest road
            </button>
          </div>

          {myLocation ? (
            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              {myLocation.lat.toFixed(5)}, {myLocation.lng.toFixed(5)}
              {myLocation.accuracyM ? ` (±${Math.round(myLocation.accuracyM)}m)` : ''}
            </div>
          ) : null}

          <div style={{ marginTop: 14, fontWeight: 700 }}>Legend</div>
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            Color = assignment key (contractor/engineer/authority). Solid = active window. Dashed = inactive. Thicker line = selected.
          </div>

          <div style={{ marginTop: 14, fontWeight: 700 }}>Selected road</div>
          {selectedFeature ? (
            (() => {
              const a: any = (selectedFeature as any).properties?.assignment;
              const auth: any = (selectedFeature as any).properties?.authority;
              const within = selectedDistanceM != null ? selectedDistanceM <= 100 : null;

              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', marginTop: 6 }}>
                    <div style={{ fontWeight: 700 }}>{(selectedFeature as any).properties?.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{(selectedFeature as any).properties?.roadId}</div>
                  </div>
                  <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                    {a?.contractorName ? `Contractor: ${a.contractorName}` : 'Contractor: —'}
                    {a?.startsOn || a?.endsOn ? ` — ${a?.startsOn ?? '—'} to ${a?.endsOn ?? '—'}` : ''}
                  </div>

                  <div style={{ marginTop: 12, fontWeight: 700 }}>Public contact</div>
                  <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                    {auth?.name ? auth.name : (selectedFeature as any).properties?.authorityId}
                    {auth?.department ? ` — ${auth.department}` : ''}
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {auth?.publicPhone ? `Phone: ${auth.publicPhone}` : 'Phone: —'}
                    {auth?.publicEmail ? ` — Email: ${auth.publicEmail}` : ''}
                  </div>
                  {auth?.website ? <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>Website: {auth.website}</div> : null}

                  <div style={{ marginTop: 12, fontWeight: 700 }}>Distance check</div>
                  {myLocation ? (
                    <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                      {selectedDistanceM == null ? '—' : `~${Math.round(selectedDistanceM)}m from selected road`}
                      {within === true ? ' (OK)' : within === false ? ' (Too far)' : ''}
                    </div>
                  ) : (
                    <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Use “Use my location” to validate the 100m rule.</div>
                  )}

                  {user?.role === 'CITIZEN' ? (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontWeight: 700 }}>Register complaint</div>
                      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Upload a photo and describe the issue.</div>

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                        <input type="file" accept="image/*" onChange={(e) => setComplaintImage(e.target.files?.[0] ?? null)} />
                        {complaintImage ? <span className="muted" style={{ fontSize: 12 }}>{complaintImage.name}</span> : null}
                      </div>

                      <textarea
                        style={{ width: '100%', marginTop: 10, minHeight: 90 }}
                        placeholder="Describe the problem (pothole, flooding, broken surface, etc.)"
                        value={complaintText}
                        onChange={(e) => setComplaintText(e.target.value)}
                      />

                      <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          className="secondary"
                          disabled={!canSubmitComplaint}
                          onClick={async () => {
                            if (!token || !myLocation || !selectedRoadId) return;
                            setSubmitting(true);
                            setError(null);
                            try {
                              const created = await createCitizenComplaint(token, {
                                roadId: selectedRoadId,
                                description: complaintText.trim(),
                                lat: myLocation.lat,
                                lng: myLocation.lng,
                                image: complaintImage
                              });
                              setSubmittedId(created.id);
                              setComplaintText('');
                              setComplaintImage(null);
                            } catch (e: any) {
                              setError(e?.message ?? 'Failed to create complaint');
                            } finally {
                              setSubmitting(false);
                            }
                          }}
                        >
                          {submitting ? 'Submitting…' : 'Submit complaint'}
                        </button>
                        {submittedId ? <span className="muted" style={{ fontSize: 12 }}>Submitted: {submittedId}</span> : null}
                      </div>
                    </div>
                  ) : null}
                </>
              );
            })()
          ) : (
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Click a segment on the map to view details.</div>
          )}
        </div>
      </div>
    </>
  );
}
