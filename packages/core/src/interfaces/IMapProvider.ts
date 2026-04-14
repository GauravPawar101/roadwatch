import { GeoCoordinate } from '../domain/GeoCoordinate';

export interface IMapProvider {
  /**
   * Pre-loads or loads map tiles for a specific region and zoom level.
   */
  loadTiles(region: { topLeft: GeoCoordinate; bottomRight: GeoCoordinate }, zoomLevel: number): Promise<void>;

  /**
   * Renders GeoJSON data directly onto the map surface.
   */
  renderGeoJson(geoJsonData: string): Promise<void>;

  /**
   * Drops a marker/pin at the specified coordinate.
   */
  dropPin(location: GeoCoordinate, pinId: string, metadata?: Record<string, unknown>): Promise<void>;

  /**
   * Removes a previously dropped pin by its ID.
   */
  removePin(pinId: string): Promise<void>;
}
