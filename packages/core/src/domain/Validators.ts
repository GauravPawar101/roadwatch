/**
 * Core validation utilities for India-centric data.
 */

// Basic Indian PIN code: 6 digits, first digit non-zero.
export const PIN_CODE_REGEX = /^[1-9][0-9]{5}$/;

export function isValidPinCode(pinCode: string): boolean {
  return PIN_CODE_REGEX.test(pinCode);
}

// Bounding box for India roughly lies between:
// Latitude: 8.4 N to 37.6 N
// Longitude: 68.7 E to 97.25 E
export const INDIA_BBOX = {
  minLat: 8.4,
  maxLat: 37.6,
  minLng: 68.7,
  maxLng: 97.25,
};

export function isWithinIndia(lat: number, lng: number): boolean {
  return (
    lat >= INDIA_BBOX.minLat &&
    lat <= INDIA_BBOX.maxLat &&
    lng >= INDIA_BBOX.minLng &&
    lng <= INDIA_BBOX.maxLng
  );
}
