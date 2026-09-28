/**
 * OpenStreetMap data acquisition for a district.
 *
 * OSM is the only source that gives a complete, licence-clean road network with
 * geometry for an arbitrary district. Everything else found for Indian cities is
 * either a PDF map, a shapefile behind a registration wall, or a list of project
 * names with no geometry. For a road-complaint platform the network *is* the
 * product: a complaint has to attach to a real road, and a road has to have a
 * position.
 *
 * Licence: ODbL. That permits reuse of the data, including commercially, with
 * attribution and share-alike for derived databases. `attribution()` returns the
 * string that must be displayed, and `OSM_ATTRIBUTION` is stored on every imported
 * row so provenance survives the database leaving this codebase.
 *
 * Politeness, because these are volunteer-run services:
 *  - one request per call, no concurrency;
 *  - a named User-Agent with contact, which Overpass requires and which lets an
 *    operator reach a human if the traffic is a problem;
 *  - the mirror list is tried in order, and a rate-limited instance is backed off
 *    rather than retried hard.
 */

/** Attribution required by the ODbL. Must be displayed wherever derived data is shown. */
export const OSM_ATTRIBUTION =
  '© OpenStreetMap contributors (ODbL) — road network and geometry';

export const OSM_LICENSE = 'ODbL-1.0';

/** Bounding box: [south, west, north, east]. Agra district, generously bounded. */
export type Bbox = [number, number, number, number];

/** Agra district, with margin so edge settlements are not clipped. */
export const AGRA_BBOX: Bbox = [26.85, 77.5, 27.35, 78.05];

export type OsmNode = { lat: number; lon: number };

export type OsmWay = {
  type: 'way';
  id: number;
  nodes?: number[];
  geometry?: OsmNode[];
  tags?: Record<string, string>;
};

export type OverpassResult = {
  version?: number;
  generator?: string;
  osm3s?: { timestamp_osm_base?: string; copyright?: string };
  elements: Array<OsmWay | { type: 'node'; id: number; lat: number; lon: number }>;
};

export type FetchOptions = {
  /** Overpass instances, tried in order. The mirror list matters: the main
   *  endpoint rate-limits aggressively and a single-host client gets cut off. */
  endpoints?: string[];
  /** Sent as User-Agent. Overpass asks for something identifying. */
  userAgent?: string;
  timeoutMs?: number;
  /** Retries per endpoint before moving on. */
  attempts?: number;
  onProgress?: (message: string) => void;
};

const DEFAULT_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Runs one Overpass query, trying mirrors in order.
 *
 * Retries are deliberately not aggressive: a 429 or 504 from Overpass means the
 * instance is busy, and hammering it is how a client gets blocked. The backoff
 * doubles, and the final failure names which endpoints were tried, because
 * "overpass failed" with no detail is not actionable.
 */
export async function runOverpass(
  query: string,
  options: FetchOptions = {},
): Promise<OverpassResult> {
  const endpoints = options.endpoints ?? DEFAULT_ENDPOINTS;
  const userAgent = options.userAgent ?? 'roadwatch-osm-import/1.0';
  const timeoutMs = options.timeoutMs ?? 180_000;
  const attempts = options.attempts ?? 2;
  const log = options.onProgress ?? (() => undefined);

  const failures: string[] = [];

  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const started = Date.now();
      try {
        log(`overpass: ${hostOf(endpoint)} attempt ${attempt}/${attempts}`);
        const response = await fetchWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': userAgent,
            },
            body: `data=${encodeURIComponent(query)}`,
          },
          timeoutMs,
        );

        if (response.status === 429 || response.status === 504) {
          // Busy, not broken. Back off and try again rather than giving up.
          const wait = 2 ** attempt * 2000;
          failures.push(`${hostOf(endpoint)} HTTP ${response.status}`);
          log(`overpass: ${hostOf(endpoint)} busy (${response.status}), waiting ${wait}ms`);
          await sleep(wait);
          continue;
        }

        if (!response.ok) {
          failures.push(`${hostOf(endpoint)} HTTP ${response.status}`);
          break;
        }

        const body = (await response.json()) as OverpassResult;
        log(
          `overpass: ${hostOf(endpoint)} ok in ${((Date.now() - started) / 1000).toFixed(1)}s, ` +
            `${body.elements.length} elements`,
        );
        return body;
      } catch (error) {
        failures.push(`${hostOf(endpoint)} ${describe(error)}`);
        log(`overpass: ${hostOf(endpoint)} failed: ${describe(error)}`);
      }
    }
  }

  throw new Error(
    `Overpass query failed on every endpoint.\nTried:\n  ${failures.join('\n  ')}\n` +
      `This is usually a rate limit rather than a bad query — retry later, or set ` +
      `overpassEndpoints to a mirror you have your own quota on.`,
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * fetch with a real deadline.
 *
 * The signal is passed *into* fetch rather than raced against it. Racing leaves
 * the socket open and the Overpass instance still grinding through a query nobody
 * will read, which is both a leak and rude to a volunteer-run service.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`timed out after ${ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Count query — cheap, and the right first call before committing to a big fetch. */
export function countQuery(bbox: Bbox, key: string, value: string): string {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:60];way["${key}"="${value}"](${s},${w},${n},${e});out count;`;
}

/**
 * Full road network with geometry.
 *
 * `out geom` puts the coordinates on the way itself, which is what the catalog
 * needs — resolving node ids separately would mean a second request and a join
 * over tens of thousands of nodes for no benefit.
 */
export function roadNetworkQuery(bbox: Bbox): string {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:180];
(
  way["highway"](${s},${w},${n},${e});
);
out geom;`;
}
