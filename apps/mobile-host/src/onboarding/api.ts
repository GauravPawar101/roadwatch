export type Country = { code: string; name: string; timeZone: string };
export type State = { code: string; name: string };
export type District = { id: string; code: string; name: string };

export type OfflineManifest = {
  districtId: string;
  bbox: { topLeft: { lat: number; lng: number }; bottomRight: { lat: number; lng: number } };
  zoom: { min: number; max: number };
  tileStyleUrl: string | null;
  roadsUrl: string;
};

export type Road = {
  id: string;
  name: string;
  roadType: string;
  authorityId: string;
  totalLengthKm: number;
};

function baseUrl(): string {
  // Works with Vite-like env injection and with react-native-config.
  // In RN, you'll typically set API_GATEWAY_URL in .env.
  const env = (globalThis as any).process?.env ?? {};
  const url = env.API_GATEWAY_URL as string | undefined;
  if (!url) throw new Error('Missing API_GATEWAY_URL env var');
  return url.replace(/\/$/, '');
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function fetchCountries(): Promise<Country[]> {
  const r = await getJson<{ countries: Country[] }>(`/public/countries`);
  return r.countries;
}

export async function fetchStates(countryCode: string): Promise<State[]> {
  const r = await getJson<{ states: State[] }>(`/public/states?country=${encodeURIComponent(countryCode)}`);
  return r.states;
}

export async function fetchDistricts(countryCode: string, stateCode: string): Promise<District[]> {
  const r = await getJson<{ districts: District[] }>(
    `/public/districts?country=${encodeURIComponent(countryCode)}&state=${encodeURIComponent(stateCode)}`
  );
  return r.districts;
}

export async function fetchOfflineManifest(districtId: string): Promise<OfflineManifest> {
  const r = await getJson<{ manifest: OfflineManifest }>(`/public/districts/${districtId}/offline-manifest`);
  return r.manifest;
}

export async function fetchDistrictRoads(roadsUrl: string): Promise<Road[]> {
  const r = await getJson<{ roads: Road[] }>(roadsUrl);
  return r.roads;
}
