import { describe, expect, it } from 'vitest';
import { isRoutableRoad, lengthKm, mapWay, simplify, centroid } from './osm-map.mjs';
import { OSM_ATTRIBUTION, OSM_LICENSE } from './osm.mjs';
import type { OsmWay } from './osm.mjs';
import type { LngLat } from './osm-map.mjs';

/**
 * The mapping decides what a "road" means in this system, so it is tested without
 * a network. A change here silently reinterprets existing data on the next import,
 * which is why the decisions are pinned rather than left to the code as written.
 */

/**
 * Two fixture builders, and the split is deliberate.
 *
 * OSM elements are built in **[lat, lon]** order because that is how a person
 * writes a coordinate, and `way()` flips them into OSM's own shape. Everything
 * that takes geometry takes **[lng, lat]**, which is GeoJSON order and matches
 * the `geometry` column.
 *
 * Having one builder for both is how this test file first passed while being
 * wrong: `lengthKm` fed a lat/lon-swapped pair still returned a plausible length,
 * because 0.001 degrees of latitude and 0.001 degrees of longitude are the same
 * order of magnitude. Only `centroid` exposed it, by putting Agra at latitude 77.
 */
const way = (tags: Record<string, string>, latLon: Array<[number, number]>): OsmWay => ({
  type: 'way',
  id: 1,
  tags,
  geometry: latLon.map(([lat, lon]) => ({ lat, lon })),
});

/** [lat, lon] — for building OSM elements. */
const straightLatLon = (n: number): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [27.1, 77.5 + i * 0.001] as [number, number]);

/** [lng, lat] — for anything taking geometry, which is the GeoJSON contract. */
const straightLngLat = (n: number): LngLat[] =>
  Array.from({ length: n }, (_, i) => [77.5 + i * 0.001, 27.1] as LngLat);

/** [lat, lon] */
const straight = straightLatLon;

describe('lengthKm', () => {
  /**
   * Asserted tightly and in the [lng, lat] order. A slack assertion here is what
   * let a real 12% error through: 0.001 degrees of longitude at 27.1 N is 99.1 m
   * and of latitude is 111.3 m, close enough that a "between 90 and 110 m" check
   * passed for the wrong answer.
   */
  it('measures a known east-west distance', () => {
    // 0.001 degrees of longitude at 27.1 N is 111.320 x cos(27.1) = 99.1 m.
    const km = lengthKm([
      [77.5, 27.1],
      [77.501, 27.1],
    ]);
    expect(km).toBeGreaterThan(0.0985);
    expect(km).toBeLessThan(0.0997);
  });

  it('measures a known north-south distance', () => {
    // 0.001 degrees of latitude is ~111.2 m at any longitude.
    const km = lengthKm([
      [77.5, 27.1],
      [77.5, 27.101],
    ]);
    expect(km).toBeGreaterThan(0.1105);
    expect(km).toBeLessThan(0.1125);
  });

  it('distinguishes the two axes, which a swapped pair could not', () => {
    // Same numeric delta, different axis. Swapping the axes makes these equal and
    // the 12% error invisible.
    const eastWest = lengthKm([[77.5, 27.1], [77.501, 27.1]]);
    const northSouth = lengthKm([[77.5, 27.1], [77.5, 27.101]]);
    expect(northSouth / eastWest).toBeGreaterThan(1.1);
  });

  it('is zero for a degenerate geometry', () => {
    expect(lengthKm([])).toBe(0);
    expect(lengthKm([[27.1, 77.5]])).toBe(0);
  });
});

describe('simplify', () => {
  it('keeps both ends of a straight line and drops the middle', () => {
    // Collinear points, so every interior point is within tolerance of the chord.
    const points = straightLngLat(50);
    const simplified = simplify(points, 5);
    expect(simplified).toHaveLength(2);
    expect(simplified[0]).toEqual(points[0]);
    expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1]);
  });

  it('keeps a point that deviates well beyond the tolerance', () => {
    // A 0.01-degree spike (~1.1 km) must survive any sane tolerance.
    const points: LngLat[] = [
      [77.5, 27.1],
      [77.505, 27.11],
      [77.51, 27.1],
    ];
    expect(simplify(points, 5)).toHaveLength(3);
  });

  it('preserves the endpoints for a single segment', () => {
    const points = straightLngLat(2);
    expect(simplify(points, 1000)).toEqual(points);
  });

  /**
   * The recursive form of Douglas-Peucker overflows the stack on a long road.
   * Agra's longest is 20 km, and a motorway can be a single way with thousands of
   * nodes, so this is a real input rather than a synthetic one.
   */
  it('handles a very long geometry without recursing', () => {
    const long = straightLngLat(20_000);
    expect(() => simplify(long, 5)).not.toThrow();
  });

  it('reduces node count substantially on a wiggly road', () => {
    const wiggly: LngLat[] = Array.from({ length: 400 }, (_, i) => [
      77.5 + i * 0.0002,
      27.1 + Math.sin(i / 8) * 0.0005,
    ]);
    expect(simplify(wiggly, 5).length).toBeLessThan(wiggly.length / 2);
  });
});

describe('isRoutableRoad', () => {
  it('keeps roads', () => {
    for (const highway of ['motorway', 'trunk', 'primary', 'residential', 'service', 'unclassified']) {
      expect(isRoutableRoad(way({ highway }, straight(3)))).toBe(true);
    }
  });

  it('excludes footways, paths and ways under construction', () => {
    for (const highway of ['footway', 'path', 'cycleway', 'steps', 'construction', 'proposed', 'abandoned']) {
      expect(isRoutableRoad(way({ highway }, straight(3)))).toBe(false);
    }
  });

  it('excludes a way with no highway tag', () => {
    expect(isRoutableRoad(way({ building: 'yes' }, straight(3)))).toBe(false);
  });
});

describe('mapWay', () => {
  it('returns null for a non-road', () => {
    expect(mapWay(way({ highway: 'footway' }, straight(3)))).toBeNull();
  });

  it('returns null when there is no usable geometry', () => {
    expect(mapWay({ type: 'way', id: 1, tags: { highway: 'primary' }, geometry: [] })).toBeNull();
    expect(mapWay({ type: 'way', id: 1, tags: { highway: 'primary' } })).toBeNull();
  });

  /**
   * The threshold that was wrong the first time. At 40 m it discarded 27.5% of
   * Agra's network, including the median road.
   */
  it('keeps a short urban lane, which is a legitimate road', () => {
    // ~30 m: a normal old-city lane and exactly the kind of road that gets a
    // pothole complaint.
    const lane: Array<[number, number]> = [
      [27.1, 77.5],
      [27.1, 77.5003],
    ];
    const road = mapWay(way({ highway: 'residential', name: 'Gali' }, lane));
    expect(road).not.toBeNull();
    expect(road!.name).toBe('Gali');
  });

  it('discards a fragment too short to carry a complaint', () => {
    // ~1 m: a degenerate split fragment, not a road.
    const stub: Array<[number, number]> = [
      [27.1, 77.5],
      [27.1, 77.50001],
    ];
    expect(mapWay(way({ highway: 'residential' }, stub))).toBeNull();
  });

  it('honours an explicit minimum length', () => {
    const road = straight(30);
    expect(mapWay(way({ highway: 'residential' }, road), { minLengthM: 1 })).not.toBeNull();
    expect(mapWay(way({ highway: 'residential' }, road), { minLengthM: 10_000 })).toBeNull();
  });

  it('maps the highway tag onto a road_type the system understands', () => {
    expect(mapWay(way({ highway: 'motorway' }, straight(20)))!.road_type).toBe('motorway');
    expect(mapWay(way({ highway: 'trunk' }, straight(20)))!.road_type).toBe('trunk');
    expect(mapWay(way({ highway: 'residential' }, straight(20)))!.road_type).toBe('residential');
    // living_street is a residential street in everything but name.
    expect(mapWay(way({ highway: 'living_street' }, straight(20)))!.road_type).toBe('residential');
  });

  it('falls back to unclassified for an unmapped highway value', () => {
    expect(mapWay(way({ highway: 'something_new' }, straight(20)))!.road_type).toBe('unclassified');
  });

  /**
   * An unnamed road is kept and typed unclassified, because a complaint against an
   * unnamed lane is still a real complaint. Dropping unnamed ways would make the
   * catalog look complete while omitting the roads people actually complain about.
   */
  it('keeps an unnamed road rather than dropping it', () => {
    const road = mapWay(way({ highway: 'residential' }, straight(20)));
    expect(road).not.toBeNull();
    expect(road!.name).toBeNull();
  });

  it('builds a stable id from the OSM way id, so re-import updates in place', () => {
    const road = mapWay(way({ highway: 'primary' }, straight(20)));
    expect(road!.id).toBe('osm:way:1');
  });

  /**
   * Licence provenance travels with every row. A row extracted from this database
   * still carries the ODbL obligation to attribute, so the attribution cannot be
   * lost by storing geometry without it.
   */
  it('stamps licence and attribution onto every row', () => {
    const road = mapWay(way({ highway: 'primary' }, straight(20)));
    expect(road!.metadata.license).toBe(OSM_LICENSE);
    expect(road!.metadata.attribution).toBe(OSM_ATTRIBUTION);
    expect(road!.metadata.source).toBe('openstreetmap');
  });

  it('preserves the tags the system filters on', () => {
    const road = mapWay(
      way(
        {
          highway: 'primary',
          name: 'NH 44',
          surface: 'asphalt',
          lanes: '4',
          oneway: 'yes',
          bridge: 'yes',
          maxspeed: '80',
        },
        straight(30),
      ),
    );
    expect(road!.metadata.surface).toBe('asphalt');
    expect(road!.metadata.lanes).toBe('4');
    expect(road!.metadata.oneway).toBe(true);
    expect(road!.metadata.bridge).toBe(true);
    expect(road!.metadata.maxspeed).toBe('80');
  });

  it('records how much geometry simplification removed', () => {
    const road = mapWay(way({ highway: 'residential' }, straight(200)), { simplifyM: 5 });
    const meta = road!.metadata as { nodes_simplified_from: number; nodes_after_simplify: number };
    expect(meta.nodes_simplified_from).toBe(200);
    expect(meta.nodes_after_simplify).toBeLessThan(200);
  });

  it('measures length on the full geometry, not the simplified one', () => {
    // Otherwise a simplified road reports the length of its chord, and the
    // catalog's total would be wrong in a way nothing would catch.
    const wiggly: Array<[number, number]> = Array.from({ length: 200 }, (_, i) => [
      27.1 + Math.sin(i / 5) * 0.002,
      77.5 + i * 0.0002,
    ]);
    const road = mapWay(way({ highway: 'residential' }, wiggly), { simplifyM: 10 })!;
    const straightLine = lengthKm([[wiggly[0]![0], wiggly[0]![1]], [wiggly[199]![0], wiggly[199]![1]]]);
    expect(road.total_length_km).toBeGreaterThan(straightLine);
  });
});

describe('centroid', () => {
  it('averages the points, in [lng, lat] order', () => {
    // The labelled tuple makes a lat-first pair a compile error, so this asserts
    // the ordering explicitly rather than relying on the type alone.
    expect(centroid([[77.0, 27.0], [77.2, 27.2]])).toEqual({ lat: 27.1, lng: 77.1 });
  });

  it('places a point in the right hemisphere, which a swapped pair would not', () => {
    // Agra is ~27 N, 77 E. A lat/lng swap would return lat 77.
    const c = centroid(straightLngLat(3));
    expect(c.lat).toBeCloseTo(27.1, 3);
    expect(c.lng).toBeGreaterThan(77.5);
  });

  it('returns the origin for an empty geometry rather than NaN', () => {
    expect(centroid([])).toEqual({ lat: 0, lng: 0 });
  });
});
