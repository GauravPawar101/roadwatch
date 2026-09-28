import { OSM_ATTRIBUTION, OSM_LICENSE, type Bbox, type OsmWay } from './osm.mjs';

/**
 * Maps OpenStreetMap ways onto the `roads_catalog` shape.
 *
 * Kept separate from the fetch and the load so the mapping — the part that decides
 * what a "road" means in this system — is testable without a network, and so a
 * re-fetch does not silently change the meaning of stored data.
 *
 * Several decisions here are worth stating, because each one discards something:
 *
 *  * **A road needs a name or a classification.** Unnamed residential ways are
 *    kept but typed `unclassified`, because a complaint against an unnamed lane is
 *    still a real complaint; dropping them would make the map look complete while
 *    leaving the lanes people actually complain about missing.
 *  * **Geometry is simplified.** A city block's worth of OSM nodes per road is
 *    more precision than a complaint marker can use, and 31,913 ways at full
 *    fidelity is a very large jsonb column. Douglas-Peucker to ~5 m keeps the
 *    shape recognisable and cuts the size by an order of magnitude.
 *  * **Footways, cycleways and steps are excluded.** They are not roads a
 *    complaint about road damage applies to, and including them would roughly
 *    double the table for no benefit.
 */

/** Highway values that are not roads, and are excluded from the catalog. */
const EXCLUDED_HIGHWAYS = new Set([
  'footway',
  'path',
  'cycleway',
  'steps',
  'pedestrian',
  'construction',
  'proposed',
  'abandoned',
  'razed',
  'platform',
  'corridor',
  'elevator',
  'escalator',
]);

/** Mapped to a `road_type` the rest of the system can reason about. */
const ROAD_TYPE_BY_HIGHWAY: Record<string, string> = {
  motorway: 'motorway',
  motorway_link: 'motorway',
  trunk: 'trunk',
  trunk_link: 'trunk',
  primary: 'primary',
  primary_link: 'primary',
  secondary: 'secondary',
  secondary_link: 'secondary',
  tertiary: 'tertiary',
  tertiary_link: 'tertiary',
  unclassified: 'unclassified',
  residential: 'residential',
  living_street: 'residential',
  service: 'service',
  road: 'unclassified',
};

/**
 * A coordinate pair, **longitude first**.
 *
 * Labelled at the type level rather than left as `number[]` because the order is
 * not a convention anyone should have to remember. The geometry column is GeoJSON,
 * which is lng-first, and a `lat`-first pair would still typecheck — placing every
 * road in the wrong hemisphere with no error anywhere. A labelled tuple makes the
 * mistake a compile error.
 */
export type LngLat = [lng: number, lat: number];

export type CatalogRoad = {
  /** Stable, derived from the OSM way id, so re-import updates rather than duplicates. */
  id: string;
  name: string | null;
  road_type: string;
  total_length_km: number;
  geometry: LngLat[];
  metadata: Record<string, unknown>;
};

/** Builds the catalog id. Prefixed so it cannot collide with a hand-entered id. */
export function catalogId(osmWayId: number): string {
  return `osm:way:${osmWayId}`;
}

/**
 * Perpendicular distance from p to segment ab, squared. Used by Douglas-Peucker
 * to avoid a square root per point.
 */
function perpendicularDistanceSq(p: LngLat, a: LngLat, b: LngLat): number {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/**
 * Douglas-Peucker, iterative.
 *
 * Recursive would blow the stack on a long motorway, and Agra has both a very
 * long bypass and dense city geometry.
 */
export function simplify(points: LngLat[], toleranceM: number): LngLat[] {
  if (points.length <= 2) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Metres per degree at Agra's latitude. Longitude degrees are shorter than
  // latitude ones, and using one tolerance for both visibly distorts east-west
  // detail.
  const mPerLat = 110_574;
  const mPerLng = 111_320 * Math.cos((27.1 * Math.PI) / 180);
  const tolSq = toleranceM * toleranceM;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxSq = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const p = points[i]!;
      // Scale into an approximation of metres so the tolerance is meaningful.
      const a: [number, number] = [points[first]![0] * mPerLng, points[first]![1] * mPerLat];
      const b: [number, number] = [points[last]![0] * mPerLng, points[last]![1] * mPerLat];
      const q: [number, number] = [p[0] * mPerLng, p[1] * mPerLat];
      const d = perpendicularDistanceSq(q, a, b);
      if (d > maxSq) {
        maxSq = d;
        index = i;
      }
    }
    if (maxSq > tolSq && index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Great-circle length in km, via the haversine formula.
 *
 * The destructuring is `[lng, lat]` because that is the `LngLat` contract, and it
 * was originally written `[lat, lng]`. That is a quiet error: at Agra's latitude a
 * swapped pair inflates every east-west distance by 1/cos(27°) ≈ 1.12, so the
 * catalog reported 6,489 km where the true figure is lower. The first test written
 * for this function passed anyway, because 0.001 degrees of latitude and 0.001
 * degrees of longitude differ by only that factor and the assertion had slack for
 * it. A second test that asserted the ordering exactly is what caught it.
 */
export function lengthKm(points: LngLat[]): number {
  if (points.length < 2) return 0;
  const R = 6371;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [lng1, lat1] = points[i - 1]!;
    const [lng2, lat2] = points[i]!;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.sqrt(a));
  }
  return total;
}

/** True for a way that should become a road in the catalog. */
export function isRoutableRoad(way: OsmWay): boolean {
  const highway = way.tags?.highway;
  if (!highway) return false;
  return !EXCLUDED_HIGHWAYS.has(highway);
}

export type MapOptions = {
  /** Douglas-Peucker tolerance in metres. */
  simplifyM?: number;
  /** Shortest road kept, in metres. See the note in mapWay for how 10 was chosen. */
  minLengthM?: number;
  bbox?: Bbox;
};

/**
 * Maps one OSM way, or returns null if it is not a road worth cataloguing.
 *
 * The bbox is used to drop the fragment of a road that clips the edge of the
 * district and continues outside it. A motorway that leaves the bbox is kept in
 * full rather than truncated: half a motorway is more misleading than a road that
 * looks like it ends at the district boundary when it does not.
 */
export function mapWay(way: OsmWay, options: MapOptions = {}): CatalogRoad | null {
  if (!isRoutableRoad(way)) return null;

  const tags = way.tags ?? {};
  const highway = tags.highway!;
  const geometry = way.geometry ?? [];
  if (geometry.length < 2) return null;

  const rawPoints: LngLat[] = geometry.map(n => [n.lon, n.lat]);
  const simplifyM = options.simplifyM ?? 5;
  const simplified = simplify(rawPoints, simplifyM);
  const fullLength = lengthKm(rawPoints);

  // Minimum length, from the measured distribution rather than intuition.
  //
  // The first pass used 40 m, which discarded 27.5% of Agra's ways — above the
  // median road length of 77 m, and above the 25th percentile of 37 m. In a dense
  // old city a 30 m lane is a normal, complaint-worthy road, not a stub, so that
  // threshold threw away exactly the roads people report potholes on.
  //
  // Measured over the 31,373 routable ways in the Agra bbox:
  //   p25 37 m   p50 77 m   p75 164 m   p90 395 m
  // Ways below 10 m: 4.4%. Below 5 m: 1.7%. The shortest way is 0.23 m, a
  // degenerate fragment of a segmented way rather than a road.
  //
  // 10 m keeps 95.6% of the network while still discarding fragments too short to
  // carry a complaint. Overridable with --min-length for a different morphology.
  const minLengthKm = options.minLengthM !== undefined ? options.minLengthM / 1000 : 0.01;
  if (fullLength < minLengthKm) return null;

  return {
    id: catalogId(way.id),
    name: tags.name?.trim() || null,
    road_type: ROAD_TYPE_BY_HIGHWAY[highway] ?? 'unclassified',
    total_length_km: Number(fullLength.toFixed(4)),
    geometry: simplified,
    metadata: {
      osm_way_id: way.id,
      osm_highway: highway,
      surface: tags.surface ?? null,
      lanes: tags.lanes ?? null,
      oneway: tags.oneway === 'yes',
      bridge: tags.bridge === 'yes',
      tunnel: tags.tunnel === 'yes',
      maxspeed: tags.maxspeed ?? null,
      // Provenance on every row: the licence travels with the data, so a row
      // extracted from this database still carries the obligation to attribute.
      license: OSM_LICENSE,
      attribution: OSM_ATTRIBUTION,
      source: 'openstreetmap',
      nodes_simplified_from: rawPoints.length,
      nodes_after_simplify: simplified.length,
    },
  };
}

/** The centre of a geometry, for seeding a district or a map marker. */
export function centroid(points: LngLat[]): { lat: number; lng: number } {
  if (points.length === 0) return { lat: 0, lng: 0 };
  let lng = 0;
  let lat = 0;
  for (const [x, y] of points) {
    lng += x;
    lat += y;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}
