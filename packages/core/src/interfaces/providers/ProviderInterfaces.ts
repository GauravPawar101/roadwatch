import type { Complaint, GeoLocation, User } from '../../domain/Entities';

export interface IMapProvider {
  loadTilesRegion(topLeft: GeoLocation, bottomRight: GeoLocation, zoom: number): Promise<void>;
  renderGeoJson(data: string): Promise<void>;
  addMarker(id: string, location: GeoLocation, isDraggable: boolean): Promise<void>;
  removeMarker(id: string): Promise<void>;
}

export interface IAIProvider {
  /** Loads an offline TFLite or CoreML model securely into memory */
  initializeLocalModel(modelName: string): Promise<void>;
  /** Analyzes an image purely natively and outputs predicted damage bounding boxes */
  detectAnomalies(imagePath: string): Promise<{ hasPothole: boolean; confidence: number; boundingBoxes: unknown[] }>;
  /** Converts unstructured text into a semantic array for offline Vector matching */
  generateEmbedding(text: string): Promise<number[]>;
}

export interface IMediaProvider {
  capturePhoto(): Promise<{ localPath: string; hash: string }>;
  captureVideo(): Promise<{ localPath: string; duration: number; sizeBytes: number }>;
  compressMedia(localPath: string, targetQuality: number): Promise<string>;
}

export interface IRoutingProvider {
  /** Executes offline A* or hooks into standard direction matrix APIs */
  calculateRoute(origin: GeoLocation, destination: GeoLocation): Promise<{ distanceKm: number; polyline: string }>;
}

export interface IAuthProvider {
  authenticateWithOTP(phone: string, otp: string): Promise<User>;
  getCurrentUser(): Promise<User | null>;
  logout(): Promise<void>;
}

export interface ISyncProvider {
  /** Orchestrates global resolution of OutboxQueue records against cloud counterparts */
  performFullSync(): Promise<void>;
  /** Flushes local telemetry immediately on edge transitions */
  pushPendingOutbox(): Promise<void>;
  /** Synchronizes road schemas locally on background tasks */
  pullLatestRoadProfiles(zoneId: string): Promise<void>;
}

export interface INotificationProvider {
  scheduleLocalNotification(title: string, body: string, triggerAtUnix: number): Promise<void>;
  registerPushToken(): Promise<string | null>;
}

export interface IGovDataProvider {
  fetchPublicWorksBudget(authorityId: string): Promise<number>;
  resolveJurisdiction(location: GeoLocation): Promise<{ authorityId: string; level: string } | null>;
}

export interface ICountryAdapter {
  /** Maps generic currencies or variables formatting to the explicit host country formats */
  formatCurrency(amount: number): string;
  parseLicensePlate(plateText: string): boolean;
  routeToMunicipalNode(complaint: Complaint): Promise<string>;
}
