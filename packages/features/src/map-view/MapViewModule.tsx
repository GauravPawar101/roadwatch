import type { GeoLocation, Road } from '@roadwatch/core/src/domain/Entities';
import { RoadEngine } from '@roadwatch/core/src/engines/RoadEngine';
import type { IMapProvider } from '@roadwatch/core/src/interfaces/providers/ProviderInterfaces';
import type { ILocalStore } from '@roadwatch/core/src/interfaces/storage/StorageInterfaces';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// ==========================================
// USE CASES
// Pure abstractions orchestrating core logic
// ==========================================
export class LoadRoadsInViewport {
  constructor(private localStore: ILocalStore) {}
  async execute(topLeft: GeoLocation, bottomRight: GeoLocation): Promise<Road[]> {
    // Triggers offline geo-spatial lookup natively
    return []; // Stub returns domain entities strictly
  }
}

export class GetRoadCondition {
  constructor(private localStore: ILocalStore, private roadEngine: RoadEngine) {}
  async execute(roadId: string): Promise<number> {
    const complaints = await this.localStore.queryComplaints();
    // Derives dynamically calculated health score purely locally without API calls
    return this.roadEngine.calculateConditionScore(roadId, complaints, Date.now() - 31536000000, Date.now());
  }
}

export class PrefetchTiles {
  constructor(private mapProvider: IMapProvider) {}
  async execute(topLeft: GeoLocation, bottomRight: GeoLocation, minZoom: number): Promise<void> {
    // Directly hits MapLibre Native implementation caching byte chunks
    await this.mapProvider.loadTilesRegion(topLeft, bottomRight, minZoom);
  }
}

// ==========================================
// VIEW MODEL (State Management)
// Isolates React lifecycle from Domain Logic
// ==========================================
export function useMapViewModel(
  loadRoadsUC: LoadRoadsInViewport,
  prefetchTilesUC: PrefetchTiles
) {
  const [roads, setRoads] = useState<Road[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(true); // Default robust offline tracking

  const loadViewport = useCallback(async (tl: GeoLocation, br: GeoLocation) => {
    setIsLoading(true);
    try {
      const fetchedRoads = await loadRoadsUC.execute(tl, br);
      setRoads(fetchedRoads);
    } catch (e) {
      console.error('Failed to load local bounding box', e);
    } finally {
      setIsLoading(false);
    }
  }, [loadRoadsUC]);

  return { roads, isLoading, isOffline, loadViewport };
}

// ==========================================
// PURE FUNCTIONAL UI COMPONENTS
// Absolutely zero business logic inside views
// ==========================================
export const OfflineBanner: React.FC<{ isOffline: boolean }> = ({ isOffline }) => {
  if (!isOffline) return null;
  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineText}>Working Offline. Data cached to device.</Text>
    </View>
  );
};

export const ConditionLegend: React.FC = () => (
  <View style={styles.legendContainer}>
    <Text style={[styles.legendItem, { color: '#2ecc71' }]}>Optimal (80-100)</Text>
    <Text style={[styles.legendItem, { color: '#f39c12' }]}>Degraded (50-79)</Text>
    <Text style={[styles.legendItem, { color: '#e74c3c' }]}>Critical (0-49)</Text>
  </View>
);

export const MapScreen: React.FC<{ viewModel?: ReturnType<typeof useMapViewModel> }> = ({ viewModel }) => {
  const safe = viewModel ?? {
    roads: [],
    isLoading: false,
    isOffline: true,
    loadViewport: async () => {}
  };
  return (
    <View style={styles.screen}>
      <OfflineBanner isOffline={safe.isOffline} />
      
      {/* Stub representing a native MapLibre wrapper */}
      <View style={styles.mapCanvas}>
        <Text style={styles.mapPlaceholderText}>
          {safe.isLoading ? 'Loading Vector Tiles...' : 'Native Map Rendering'}
        </Text>
      </View>

      <ConditionLegend />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAFA' },
  offlineBanner: { backgroundColor: '#F39C12', padding: 12, alignItems: 'center' },
  offlineText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  mapCanvas: { flex: 1, backgroundColor: '#E0E6ED', justifyContent: 'center', alignItems: 'center' },
  mapPlaceholderText: { color: '#7F8C8D', fontWeight: '500' },
  legendContainer: { flexDirection: 'row', justifyContent: 'space-around', padding: 16, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderColor: '#EDF2F7' },
  legendItem: { fontSize: 12, fontWeight: 'bold' }
});
