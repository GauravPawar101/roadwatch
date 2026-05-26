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
    try {
      // Query roads within the bounding box from local storage
      // Some local store implementations expose `queryRoads(boundingBox)`.
      // Use a safe any-cast to avoid type errors across differing implementations.
      const allRoads: Road[] = typeof (this.localStore as any).queryRoads === 'function'
        ? await (this.localStore as any).queryRoads(topLeft, bottomRight)
        : [];
      
      // Filter roads that fall within the viewport bounds
      const roadsInViewport = allRoads.filter((road: Road) => {
        // Check if road's coordinates are within the bounding box
        const coords = (road as any).coordinates as Array<any> | undefined;
        if (coords && coords.length > 0) {
          return coords.some((coord: any) =>
            coord.latitude >= bottomRight.latitude &&
            coord.latitude <= topLeft.latitude &&
            coord.longitude >= topLeft.longitude &&
            coord.longitude <= bottomRight.longitude
          );
        }
        
        // Fallback: check if road's primary location is in viewport
        const loc = (road as any).location as any | undefined;
        if (loc) {
          return loc.latitude >= bottomRight.latitude &&
                 loc.latitude <= topLeft.latitude &&
                 loc.longitude >= topLeft.longitude &&
                 loc.longitude <= bottomRight.longitude;
        }
        
        return false;
      });
      
      // Sort by distance from viewport center for better rendering priority
      const centerLat = (topLeft.latitude + bottomRight.latitude) / 2;
      const centerLng = (topLeft.longitude + bottomRight.longitude) / 2;
      
      roadsInViewport.sort((a, b) => {
        const aLoc = (a as any).location as any | undefined;
        const bLoc = (b as any).location as any | undefined;
        const distA = this.calculateDistance(centerLat, centerLng, aLoc?.latitude || 0, aLoc?.longitude || 0);
        const distB = this.calculateDistance(centerLat, centerLng, bLoc?.latitude || 0, bLoc?.longitude || 0);
        return distA - distB;
      });
      
      console.log(`[MapView] Loaded ${roadsInViewport.length} roads in viewport`);
      return roadsInViewport;
      
    } catch (error) {
      console.error('[MapView] Error loading roads in viewport:', error);
      return [];
    }
  }
  
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
}

export class GetRoadCondition {
  constructor(private localStore: ILocalStore, private roadEngine: RoadEngine) {}
  
  async execute(roadId: string): Promise<number> {
    try {
      const complaints = await this.localStore.queryComplaints();
      
      // Filter complaints for this specific road
      const roadComplaints = complaints.filter((complaint: any) => 
        complaint.roadId === roadId || 
        (complaint as any).metadata?.roadId === roadId
      );
      
      // Calculate condition score using the road engine
      const conditionScore = this.roadEngine.calculateConditionScore(
        roadId, 
        roadComplaints, 
        Date.now() - 31536000000, // 1 year ago
        Date.now()
      );
      
      // Ensure score is within valid range (0-100)
      const normalizedScore = Math.max(0, Math.min(100, conditionScore));
      
      console.log(`[MapView] Road ${roadId} condition score: ${normalizedScore}`);
      return normalizedScore;
      
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[MapView] Error calculating road condition for ${roadId}:`, msg);
      // Return neutral score on error
      return 50;
    }
  }
}

export class PrefetchTiles {
  constructor(private mapProvider: IMapProvider) {}
  
  async execute(topLeft: GeoLocation, bottomRight: GeoLocation, minZoom: number): Promise<void> {
    try {
      console.log(`[MapView] Prefetching tiles for region: ${topLeft.latitude},${topLeft.longitude} to ${bottomRight.latitude},${bottomRight.longitude} at zoom ${minZoom}`);
      
      // Calculate tile bounds for the region
      const tileBounds = this.calculateTileBounds(topLeft, bottomRight, minZoom);
      
      // Prefetch tiles in batches to avoid overwhelming the system
      const batchSize = 10;
      const totalTiles = tileBounds.tiles.length;
      
      for (let i = 0; i < totalTiles; i += batchSize) {
        const batch = tileBounds.tiles.slice(i, i + batchSize);
        
        // Load tiles in parallel for this batch
        const tilePromises = batch.map(tile => {
          const loader = (this.mapProvider as any).loadTile
          return typeof loader === 'function' ? loader.call(this.mapProvider, tile.x, tile.y, tile.z) : Promise.resolve();
        });

        await Promise.allSettled(tilePromises);
        
        // Progress logging
        const progress = Math.min(100, Math.round(((i + batchSize) / totalTiles) * 100));
        console.log(`[MapView] Tile prefetch progress: ${progress}%`);
      }
      
      // Cache the region bounds for offline use (providers may or may not implement loadTilesRegion)
      if (typeof (this.mapProvider as any).loadTilesRegion === 'function') {
        await (this.mapProvider as any).loadTilesRegion(topLeft, bottomRight, minZoom);
      }
      
      console.log(`[MapView] Successfully prefetched ${totalTiles} tiles`);
      
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[MapView] Error prefetching tiles:', msg);
      throw new Error(`Failed to prefetch map tiles: ${msg}`);
    }
  }
  
  private calculateTileBounds(topLeft: GeoLocation, bottomRight: GeoLocation, zoom: number): {
    tiles: Array<{ x: number; y: number; z: number }>;
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
  } {
    // Convert lat/lng to tile coordinates
    const minTileX = this.lngToTileX(topLeft.longitude, zoom);
    const maxTileX = this.lngToTileX(bottomRight.longitude, zoom);
    const minTileY = this.latToTileY(topLeft.latitude, zoom);
    const maxTileY = this.latToTileY(bottomRight.latitude, zoom);
    
    const tiles: Array<{ x: number; y: number; z: number }> = [];
    
    for (let x = minTileX; x <= maxTileX; x++) {
      for (let y = minTileY; y <= maxTileY; y++) {
        tiles.push({ x, y, z: zoom });
      }
    }
    
    return {
      tiles,
      bounds: { minX: minTileX, maxX: maxTileX, minY: minTileY, maxY: maxTileY }
    };
  }
  
  private lngToTileX(lng: number, zoom: number): number {
    return Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  }
  
  private latToTileY(lat: number, zoom: number): number {
    const latRad = lat * Math.PI / 180;
    return Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * Math.pow(2, zoom));
  }
}

// ==========================================
// VIEW MODEL (State Management)
// Isolates React lifecycle from Domain Logic
// ==========================================
export function useMapViewModel(
  loadRoadsUC: LoadRoadsInViewport,
  prefetchTilesUC: PrefetchTiles,
  getRoadConditionUC?: GetRoadCondition
) {
  const [roads, setRoads] = useState<Road[]>([]);
  const [roadConditions, setRoadConditions] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(true);
  const [currentViewport, setCurrentViewport] = useState<{topLeft: GeoLocation, bottomRight: GeoLocation} | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadViewport = useCallback(async (tl: GeoLocation, br: GeoLocation) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Load roads in the viewport
      const fetchedRoads = await loadRoadsUC.execute(tl, br);
      setRoads(fetchedRoads);
      setCurrentViewport({ topLeft: tl, bottomRight: br });
      
      // Load road conditions if available
      if (getRoadConditionUC && fetchedRoads.length > 0) {
        const conditionPromises = fetchedRoads.map(async (road) => {
          try {
            const condition = await getRoadConditionUC.execute(road.id);
            return { roadId: road.id, condition };
          } catch (error) {
            console.warn(`Failed to load condition for road ${road.id}:`, error);
            return { roadId: road.id, condition: 50 }; // Default neutral condition
          }
        });
        
        const conditions = await Promise.all(conditionPromises);
        const conditionMap = new Map(conditions.map(c => [c.roadId, c.condition]));
        setRoadConditions(conditionMap);
      }
      
      console.log(`[MapViewModel] Loaded ${fetchedRoads.length} roads in viewport`);
      
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
      console.error('Failed to load viewport data:', e);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [loadRoadsUC, getRoadConditionUC]);

  const prefetchCurrentViewport = useCallback(async (zoom: number = 12) => {
    if (!currentViewport) {
      console.warn('[MapViewModel] No current viewport to prefetch');
      return;
    }
    
    try {
      setIsLoading(true);
      await prefetchTilesUC.execute(currentViewport.topLeft, currentViewport.bottomRight, zoom);
      console.log('[MapViewModel] Viewport tiles prefetched successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to prefetch tiles';
      console.error('[MapViewModel] Prefetch failed:', error);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [prefetchTilesUC, currentViewport]);

  const refreshRoadConditions = useCallback(async () => {
    if (!getRoadConditionUC || roads.length === 0) return;
    
    try {
      const conditionPromises = roads.map(async (road) => {
        const condition = await getRoadConditionUC.execute(road.id);
        return { roadId: road.id, condition };
      });
      
      const conditions = await Promise.all(conditionPromises);
      const conditionMap = new Map(conditions.map(c => [c.roadId, c.condition]));
      setRoadConditions(conditionMap);
      
    } catch (error) {
      console.error('[MapViewModel] Failed to refresh road conditions:', error);
    }
  }, [getRoadConditionUC, roads]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { 
    roads, 
    roadConditions,
    isLoading, 
    isOffline, 
    currentViewport,
    error,
    loadViewport,
    prefetchCurrentViewport,
    refreshRoadConditions,
    clearError
  };
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

export const MapScreen: React.FC<{ 
  viewModel?: ReturnType<typeof useMapViewModel>;
  onRoadSelect?: (road: Road) => void;
  onMapPress?: (location: GeoLocation) => void;
}> = ({ viewModel, onRoadSelect, onMapPress }) => {
  const safe = viewModel ?? {
    roads: [],
    roadConditions: new Map(),
    isLoading: false,
    isOffline: true,
    currentViewport: null,
    error: null,
    loadViewport: async () => {},
    prefetchCurrentViewport: async () => {},
    refreshRoadConditions: async () => {},
    clearError: () => {}
  };

  const getConditionColor = (condition: number): string => {
    if (condition >= 80) return '#2ecc71'; // Green - Optimal
    if (condition >= 50) return '#f39c12'; // Orange - Degraded  
    return '#e74c3c'; // Red - Critical
  };

  const getConditionLabel = (condition: number): string => {
    if (condition >= 80) return 'Optimal';
    if (condition >= 50) return 'Degraded';
    return 'Critical';
  };

  return (
    <View style={styles.screen}>
      <OfflineBanner isOffline={safe.isOffline} />
      
      {safe.error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{safe.error}</Text>
          <Text style={styles.errorDismiss} onPress={safe.clearError}>✕</Text>
        </View>
      )}
      
      {/* Map Canvas with Road Overlays */}
      <View style={styles.mapCanvas}>
        {safe.isLoading ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading Vector Tiles...</Text>
            <Text style={styles.loadingSubtext}>
              {safe.roads.length > 0 ? `${safe.roads.length} roads loaded` : 'Fetching road data...'}
            </Text>
          </View>
        ) : (
          <View style={styles.mapContent}>
            <Text style={styles.mapPlaceholderText}>Native Map Rendering</Text>
            
            {/* Road Overlays */}
            {safe.roads.length > 0 && (
              <View style={styles.roadOverlays}>
                <Text style={styles.roadCount}>{safe.roads.length} roads in view</Text>
                
                {/* Road List (simplified representation) */}
                <View style={styles.roadList}>
                  {safe.roads.slice(0, 5).map((road, index) => {
                    const condition = safe.roadConditions.get(road.id) || 50;
                    const conditionColor = getConditionColor(condition);
                    
                    return (
                      <View 
                        key={road.id} 
                        style={[styles.roadItem, { borderLeftColor: conditionColor }]}
                        onTouchEnd={() => onRoadSelect?.(road)}
                      >
                        <Text style={styles.roadName}>{road.name || `Road ${road.id.slice(0, 8)}`}</Text>
                        <Text style={[styles.roadCondition, { color: conditionColor }]}>
                          {getConditionLabel(condition)} ({condition})
                        </Text>
                      </View>
                    );
                  })}
                  
                  {safe.roads.length > 5 && (
                    <Text style={styles.moreRoads}>
                      +{safe.roads.length - 5} more roads
                    </Text>
                  )}
                </View>
              </View>
            )}
            
            {/* Viewport Info */}
            {safe.currentViewport && (
              <View style={styles.viewportInfo}>
                <Text style={styles.viewportText}>
                  Viewport: {safe.currentViewport.topLeft.latitude.toFixed(4)}, {safe.currentViewport.topLeft.longitude.toFixed(4)}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      <ConditionLegend />
      
      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <Text 
          style={styles.actionButton}
          onPress={() => safe.prefetchCurrentViewport(12)}
        >
          Cache Tiles
        </Text>
        <Text 
          style={styles.actionButton}
          onPress={safe.refreshRoadConditions}
        >
          Refresh Conditions
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAFA' },
  offlineBanner: { backgroundColor: '#F39C12', padding: 12, alignItems: 'center' },
  offlineText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  errorBanner: { 
    backgroundColor: '#e74c3c', 
    padding: 12, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  errorText: { color: '#FFFFFF', fontWeight: '600', fontSize: 12, flex: 1 },
  errorDismiss: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16, paddingLeft: 10 },
  mapCanvas: { flex: 1, backgroundColor: '#E0E6ED' },
  loadingContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center',
    padding: 20
  },
  loadingText: { color: '#7F8C8D', fontWeight: '600', fontSize: 16 },
  loadingSubtext: { color: '#95A5A6', fontWeight: '400', fontSize: 12, marginTop: 8 },
  mapContent: { flex: 1, position: 'relative' },
  mapPlaceholderText: { 
    color: '#7F8C8D', 
    fontWeight: '500', 
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: 'rgba(255,255,255,0.8)',
    padding: 8,
    borderRadius: 4
  },
  roadOverlays: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 8,
    padding: 12,
    maxHeight: 200
  },
  roadCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 8
  },
  roadList: {
    maxHeight: 150
  },
  roadItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderLeftWidth: 4,
    marginVertical: 2,
    backgroundColor: '#f8f9fa'
  },
  roadName: {
    fontSize: 12,
    fontWeight: '500',
    color: '#2c3e50',
    flex: 1
  },
  roadCondition: {
    fontSize: 11,
    fontWeight: '600'
  },
  moreRoads: {
    fontSize: 11,
    color: '#7f8c8d',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8
  },
  viewportInfo: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 8,
    borderRadius: 4
  },
  viewportText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: 'monospace'
  },
  legendContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-around', 
    padding: 16, 
    backgroundColor: '#FFFFFF', 
    borderTopWidth: 1, 
    borderColor: '#EDF2F7' 
  },
  legendItem: { fontSize: 12, fontWeight: 'bold' },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 12,
    backgroundColor: '#ecf0f1',
    borderTopWidth: 1,
    borderColor: '#bdc3c7'
  },
  actionButton: {
    backgroundColor: '#3498db',
    color: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    overflow: 'hidden'
  }
});
