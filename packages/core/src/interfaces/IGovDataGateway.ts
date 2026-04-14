import { GeoCoordinate } from '../domain/GeoCoordinate';
import { Authority } from '../domain/Authority';

export interface IGovDataGateway {
  /**
   * Resolves the authoritative body given a set of GPS coordinates.
   */
  getAuthorityByLocation(location: GeoCoordinate): Promise<Authority | null>;

  /**
   * Fetches metadata for a specific road asset from government endpoints.
   */
  getRoadDetails(roadId: string): Promise<Record<string, unknown>>;

  /**
   * Retrieves public records for the maintenance budget of a specific authority.
   */
  fetchPublicWorksBudget(authorityId: string): Promise<number>;
}
