import type { GeoLocation } from '../domain/Entities';

/**
 * Calculates the great-circle distance between two points on the Earth's surface.
 * @returns Distance in kilometers.
 */
export function calculateHaversineDistance(coord1: GeoLocation, coord2: GeoLocation): number {
  const R = 6371; // Earth's mean radius in kilometers
  const dLat = degreesToRadians(coord2.latitude - coord1.latitude);
  const dLon = degreesToRadians(coord2.longitude - coord1.longitude);

  const lat1 = degreesToRadians(coord1.latitude);
  const lat2 = degreesToRadians(coord2.latitude);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Checks if a specific point falls accurately within a Top-Left / Bottom-Right Bounding Box.
 */
export function isWithinBoundingBox(
  point: GeoLocation,
  topLeft: GeoLocation,
  bottomRight: GeoLocation
): boolean {
  // Northern hemisphere logic: Top (North) is higher latitude, Bottom (South) is lower
  // Eastern hemisphere logic: Left (West) is lower longitude, Right (East) is higher
  return (
    point.latitude <= topLeft.latitude &&
    point.latitude >= bottomRight.latitude &&
    point.longitude >= topLeft.longitude &&
    point.longitude <= bottomRight.longitude
  );
}
