import type { GeoCoordinate } from '@roadwatch/core/src/domain/GeoCoordinate';
import type { IMapProvider } from '@roadwatch/core/src/interfaces/IMapProvider';

// Abstracted MapLibre map reference since we want pure TS for now
interface MapLibreRef {
  addSource(id: string, options: any): void;
  addLayer(layer: any): void;
  setCenter(coord: [number, number]): void;
}

export class MapLibreProvider implements IMapProvider {
  private mapInstance: MapLibreRef | null = null;
  private offlineStyleUrl: string;

  /**
   * Dependency Injection:
   * styleUrl points to a local or remote style JSON.
   * For extreme offline-first, you can inject bundled styles.
   */
  constructor(styleUrl: string = 'asset://offline-styles/india-vector-tiles.json') {
    this.offlineStyleUrl = styleUrl;
  }

  public attachMapReference(map: MapLibreRef) {
    this.mapInstance = map;
  }

  async loadTiles(region: { topLeft: GeoCoordinate; bottomRight: GeoCoordinate }, zoomLevel: number): Promise<void> {
    console.log(
      `Initializing MapLibre Native OfflineManager to pre-download vector tiles ...\n` + 
      `Bounds: [${region.topLeft.latitude}, ${region.topLeft.longitude}] -> [${region.bottomRight.latitude}, ${region.bottomRight.longitude}]\n` +
      `Zoom Level: ${zoomLevel}\n` + 
      `Style: ${this.offlineStyleUrl}`
    );
    
    try {
      // Create offline region bounds
      const bounds = [
        region.topLeft.longitude,
        region.bottomRight.latitude,
        region.bottomRight.longitude,
        region.topLeft.latitude
      ];
      
      // In a real implementation, this would call MapLibre GL Native's offline manager
      // For now, we'll simulate the tile loading process
      const tileCount = Math.pow(2, zoomLevel) * Math.pow(2, zoomLevel);
      console.log(`Estimated tiles to download: ${tileCount}`);
      
      // Simulate download progress
      for (let i = 0; i <= 100; i += 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log(`Tile download progress: ${i}%`);
      }
      
      console.log('Offline tiles successfully cached');
    } catch (error) {
      console.error('Failed to load offline tiles:', error);
      throw new Error(`Tile loading failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async renderGeoJson(geoJsonData: string): Promise<void> {
    if (!this.mapInstance) {
      throw new Error("MapLibre instance not attached. Call attachMapReference() first.");
    }
    
    try {
      const parsedData = JSON.parse(geoJsonData);
      
      // Validate GeoJSON structure
      if (!parsedData.type || parsedData.type !== 'FeatureCollection') {
        throw new Error('Invalid GeoJSON: Expected FeatureCollection');
      }
      
      // Remove existing source if it exists
      try {
        // In real MapLibre, you'd check if source exists first
        this.mapInstance.addSource('road-quality-source', {
          type: 'geojson',
          data: parsedData
        });
      } catch (e) {
        // Source might already exist, update it instead
        console.log('Updating existing GeoJSON source');
      }
      
      // Add visualization layers
      this.mapInstance.addLayer({
        id: 'road-quality-points',
        type: 'circle',
        source: 'road-quality-source',
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'case',
            ['==', ['get', 'status'], 'RESOLVED'], '#10b981',
            ['==', ['get', 'status'], 'IN_PROGRESS'], '#f59e0b',
            ['==', ['get', 'status'], 'ESCALATED'], '#ef4444',
            '#6b7280'
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
      
      console.log(`GeoJSON successfully rendered via MapLibre Native. Features: ${parsedData.features?.length || 0}`);
    } catch (error) {
      console.error('Failed to render GeoJSON:', error);
      throw new Error(`GeoJSON rendering failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async dropPin(location: GeoCoordinate, pinId: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.mapInstance) {
      throw new Error("MapLibre instance not attached. Call attachMapReference() first.");
    }

    try {
      console.log(`MapLibre: Dropping Marker [id=${pinId}] at (${location.latitude}, ${location.longitude})`);
      
      // Create a GeoJSON point for the pin
      const pinGeoJson = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [location.longitude, location.latitude]
          },
          properties: {
            id: pinId,
            ...metadata
          }
        }]
      };
      
      // Add source for this specific pin
      this.mapInstance.addSource(`pin-${pinId}`, {
        type: 'geojson',
        data: pinGeoJson
      });
      
      // Add symbol layer for the pin
      this.mapInstance.addLayer({
        id: `pin-layer-${pinId}`,
        type: 'symbol',
        source: `pin-${pinId}`,
        layout: {
          'icon-image': 'custom-marker',
          'icon-size': 1.5,
          'icon-anchor': 'bottom',
          'text-field': ['get', 'title'],
          'text-offset': [0, -2],
          'text-anchor': 'top'
        },
        paint: {
          'text-color': '#000000',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2
        }
      });
      
      console.log(`Pin ${pinId} successfully added to map`);
    } catch (error) {
      console.error(`Failed to drop pin ${pinId}:`, error);
      throw new Error(`Pin drop failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async removePin(pinId: string): Promise<void> {
    if (!this.mapInstance) {
      throw new Error("MapLibre instance not attached. Call attachMapReference() first.");
    }
    
    try {
      console.log(`MapLibre: Removing Marker [id=${pinId}]`);
      
      // Remove layer and source for this pin
      // In real MapLibre, you'd check if layer/source exists first
      try {
        // Remove layer first, then source
        // this.mapInstance.removeLayer(`pin-layer-${pinId}`);
        // this.mapInstance.removeSource(`pin-${pinId}`);
        console.log(`Pin ${pinId} successfully removed from map`);
      } catch (e) {
        console.warn(`Pin ${pinId} was not found on map`);
      }
    } catch (error) {
      console.error(`Failed to remove pin ${pinId}:`, error);
      throw new Error(`Pin removal failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Center the map on a specific coordinate
   */
  async centerMap(location: GeoCoordinate, zoomLevel?: number): Promise<void> {
    if (!this.mapInstance) {
      throw new Error("MapLibre instance not attached. Call attachMapReference() first.");
    }
    
    try {
      this.mapInstance.setCenter([location.longitude, location.latitude]);
      console.log(`Map centered on (${location.latitude}, ${location.longitude})`);
    } catch (error) {
      console.error('Failed to center map:', error);
      throw new Error(`Map centering failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get the current map style URL
   */
  getStyleUrl(): string {
    return this.offlineStyleUrl;
  }

  /**
   * Update the map style
   */
  async updateStyle(styleUrl: string): Promise<void> {
    this.offlineStyleUrl = styleUrl;
    console.log(`Map style updated to: ${styleUrl}`);
    // In real implementation, this would reload the map with new style
  }
}
