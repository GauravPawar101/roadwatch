export type MapPoint = { lat: number; lng: number; severity?: number };

export type DensityZone = {
  lat: number;
  lng: number;
  count: number;
  severeCount: number;
  intensity: number;
  radiusMeters: number;
};

export type DensityZoneOptions = {
  /** Grid cell size in degrees (~0.008 ≈ 900 m latitude). */
  gridSizeDeg?: number;
  /** Minimum complaints in a cell before it is highlighted. */
  minCount?: number;
  /** Base circle radius in meters. */
  radiusMeters?: number;
};

const DEFAULT_GRID = 0.008;
const DEFAULT_MIN_COUNT = 3;
const DEFAULT_RADIUS = 420;

function cellCenter(latCell: number, lngCell: number, gridSize: number) {
  return {
    lat: (latCell + 0.5) * gridSize,
    lng: (lngCell + 0.5) * gridSize,
  };
}

/** Cluster complaint coordinates into grid cells and flag high-density regions. */
export function computeDensityZones(
  points: MapPoint[],
  options: DensityZoneOptions = {},
): DensityZone[] {
  const gridSize = options.gridSizeDeg ?? DEFAULT_GRID;
  const minCount = options.minCount ?? DEFAULT_MIN_COUNT;
  const radiusMeters = options.radiusMeters ?? DEFAULT_RADIUS;

  const cells = new Map<
    string,
    { latCell: number; lngCell: number; count: number; severeCount: number }
  >();

  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const latCell = Math.floor(point.lat / gridSize);
    const lngCell = Math.floor(point.lng / gridSize);
    const key = `${latCell}:${lngCell}`;
    const current = cells.get(key) ?? { latCell, lngCell, count: 0, severeCount: 0 };
    current.count += 1;
    if ((point.severity ?? 0) >= 4) current.severeCount += 1;
    cells.set(key, current);
  }

  const qualifying = [...cells.values()].filter((cell) => cell.count >= minCount);
  if (qualifying.length === 0) return [];

  const maxCount = Math.max(...qualifying.map((cell) => cell.count));

  return qualifying
    .map((cell) => {
      const center = cellCenter(cell.latCell, cell.lngCell, gridSize);
      const intensity = maxCount <= minCount ? 1 : (cell.count - minCount) / (maxCount - minCount);
      return {
        lat: center.lat,
        lng: center.lng,
        count: cell.count,
        severeCount: cell.severeCount,
        intensity: Math.min(1, Math.max(0, intensity)),
        radiusMeters: radiusMeters + intensity * 180,
      };
    })
    .sort((a, b) => b.count - a.count);
}

type DensityLayerHandle = {
  layers: unknown[];
  remove: () => void;
};

/** Draw semi-transparent red overlays for high complaint density on a Leaflet map. */
export function createDensityZoneLayers(
  L: { circle: (latlng: [number, number], opts: Record<string, unknown>) => { addTo: (map: unknown) => unknown; bindPopup: (html: string) => unknown } },
  map: unknown,
  zones: DensityZone[],
): DensityLayerHandle {
  const layers: unknown[] = [];

  for (const zone of zones) {
    const fillOpacity = 0.14 + zone.intensity * 0.36;
    const layer = L.circle([zone.lat, zone.lng], {
      radius: zone.radiusMeters,
      stroke: true,
      color: 'rgba(185, 28, 28, 0.65)',
      weight: 1.5,
      fillColor: '#dc2626',
      fillOpacity,
      className: 'complaint-density-zone',
    })
      .bindPopup(
        `<div style="min-width:160px;font-size:12px;line-height:1.5">
          <strong style="color:#991b1b">High complaint density</strong><br/>
          ${zone.count} reports in this area
          ${zone.severeCount > 0 ? `<br/>${zone.severeCount} severe` : ''}
        </div>`,
      )
      .addTo(map);
    layers.push(layer);
  }

  return {
    layers,
    remove: () => {
      for (const layer of layers) {
        try {
          (map as { removeLayer: (l: unknown) => void }).removeLayer(layer);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export function expandHeatmapAggregates(
  rows: Array<{ lat: number; lng: number; count?: number; severity?: number }>,
): MapPoint[] {
  const points: MapPoint[] = [];
  for (const row of rows) {
    const repeats = Math.min(Math.max(row.count ?? 1, 1), 12);
    for (let i = 0; i < repeats; i++) {
      points.push({ lat: row.lat, lng: row.lng, severity: row.severity });
    }
  }
  return points;
}
