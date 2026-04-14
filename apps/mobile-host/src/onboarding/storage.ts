import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  onboardingDone: 'RW_ONBOARDING_DONE_V1',
  selectedCountry: 'RW_SELECTED_COUNTRY_V1',
  selectedState: 'RW_SELECTED_STATE_V1',
  selectedDistrictId: 'RW_SELECTED_DISTRICT_ID_V1',
  offlineDownloaded: 'RW_OFFLINE_DOWNLOADED_V1',
  cachedRoads: 'RW_CACHED_ROADS_V1'
} as const;

export type OnboardingState = {
  done: boolean;
  country?: string;
  state?: string;
  districtId?: string;
  offlineDownloaded?: boolean;
};

export async function getOnboardingState(): Promise<OnboardingState> {
  const [done, country, state, districtId, offlineDownloaded] = await Promise.all([
    AsyncStorage.getItem(KEYS.onboardingDone),
    AsyncStorage.getItem(KEYS.selectedCountry),
    AsyncStorage.getItem(KEYS.selectedState),
    AsyncStorage.getItem(KEYS.selectedDistrictId),
    AsyncStorage.getItem(KEYS.offlineDownloaded)
  ]);

  return {
    done: done === '1',
    country: country ?? undefined,
    state: state ?? undefined,
    districtId: districtId ?? undefined,
    offlineDownloaded: offlineDownloaded === '1'
  };
}

export async function setCountryState(country: string, state: string): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(KEYS.selectedCountry, country),
    AsyncStorage.setItem(KEYS.selectedState, state)
  ]);
}

export async function setDistrict(districtId: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.selectedDistrictId, districtId);
}

export async function setOfflineDownloaded(value: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.offlineDownloaded, value ? '1' : '0');
}

export async function setOnboardingDone(): Promise<void> {
  await AsyncStorage.setItem(KEYS.onboardingDone, '1');
}

export type CachedRoad = {
  id: string;
  name: string;
  roadType: string;
  authorityId: string;
  totalLengthKm: number;
};

export async function cacheRoads(roads: CachedRoad[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.cachedRoads, JSON.stringify(roads));
}

export async function getCachedRoads(): Promise<CachedRoad[]> {
  const raw = await AsyncStorage.getItem(KEYS.cachedRoads);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as CachedRoad[];
  } catch {
    return [];
  }
}

export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}
