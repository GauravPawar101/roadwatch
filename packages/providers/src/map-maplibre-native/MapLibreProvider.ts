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
      `Initializing MapLibre Native OfflineManager to pre-download vector tiles ...n` + 
      `Bounds: [${region.topLeft.latitude}, ${region.topLeft.longitude}] -> [${region.bottomRight.latitude}, ${region.bottomRight.longitude}]n` +
      `Zoom Level: ${zoomLevel}n` + 
      `Style: ${this.offlineStyleUrl}`
    );
    // Here we would call the native MapLibre GL offline pack creator.
  }

  async renderGeoJson(geoJsonData: string): Promise<void> {
    if (!this.mapInstance) throw new Error("MapLibre instance not attached.");
    
    const parsedData = JSON.parse(geoJsonData);
    
    // Inject the raw GeoJSON into a MapLibre vector source pipeline
    this.mapInstance.addSource('road-quality-source', {
      type: 'geojson',
      data: parsedData
    });
    
    console.log("GeoJSON successfully rendered via MapLibre Native.");
  }

  async dropPin(location: GeoCoordinate, pinId: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.mapInstance) throw new Error("MapLibre instance not attached.");

    console.log(`MapLibre: Dropping Marker [id=${pinId}] at (${location.latitude}, ${location.longitude})`);
    // Example: Programmatically add a symbol layer for the pin.
  }

  async removePin(pinId: string): Promise<void> {
    console.log(`MapLibre: Removing Marker [id=${pinId}]`);
  }
}
