import { GeoCoordinate } from '../domain/GeoCoordinate';

export interface PhotoResult {
  imagePath: string;
  imageHash: string;
  exifData: Record<string, unknown>;
}

export interface IDeviceHardware {
  /**
   * Prompts the user or underlying OS for location permissions.
   */
  requestLocationPermissions(): Promise<boolean>;

  /**
   * Prompts the user or underlying OS for camera permissions.
   */
  requestCameraPermissions(): Promise<boolean>;

  /**
   * Gets the current, highly accurate GPS coordinate from the device.
   */
  getCurrentLocation(): Promise<GeoCoordinate>;

  /**
   * Opens the device camera or captures a photo silently, returning the result and EXIF data.
   */
  capturePhoto(): Promise<PhotoResult>;
}
