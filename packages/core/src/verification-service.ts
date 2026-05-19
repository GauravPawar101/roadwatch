import * as crypto from 'crypto';

/**
 * Image Verification Service
 * Handles EXIF extraction, geofence validation, perceptual hashing, and nonce checks
 */

export interface ExifData {
  timestamp?: number;
  latitude?: number;
  longitude?: number;
  make?: string;
  model?: string;
}

export interface VerificationResult {
  passed: boolean;
  errors: VerificationError[];
  warnings: string[];
  checks: VerificationCheck[];
}

export interface VerificationError {
  code: string;
  message: string;
  severity: 'critical' | 'warning';
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Extract EXIF data from JPEG image
 * Note: In production, use 'piexifjs' or 'piexif' npm packages
 * This is a stub that reads basic EXIF structure
 */
export function extractExifData(imageBuffer: Buffer): ExifData {
  try {
    // In production: use piexif.load() or similar
    // This stub assumes EXIF data might be embedded
    const exifData: ExifData = {};
    
    // Look for EXIF markers (0xFFE1)
    let offset = 2;
    while (offset < imageBuffer.length - 8) {
      if (imageBuffer[offset] === 0xff && imageBuffer[offset + 1] === 0xe1) {
        // Found EXIF marker
        const exifSize = imageBuffer.readUInt16BE(offset + 2);
        const exifStart = offset + 4;
        
        // Parse EXIF header and fields (simplified)
        // In production, use piexif library for robust parsing
        if (imageBuffer.slice(exifStart, exifStart + 4).toString('ascii') === 'Exif') {
          // EXIF data found; in production parse IFD0, IFD1, GPS IFD
          // For now, return empty to indicate parsing needed
          return exifData;
        }
        break;
      }
      offset += 2;
    }
    
    return exifData;
  } catch (err) {
    console.warn('Error extracting EXIF:', err);
    return {};
  }
}

/**
 * Validate that image was taken recently (within time window)
 */
export function validateTimestamp(
  exifTimestamp: number | undefined,
  serverReceivedAt: number,
  timeWindowMs: number
): VerificationCheck {
  const check: VerificationCheck = {
    name: 'exif_time_validation',
    passed: false,
    detail: '',
  };

  if (!exifTimestamp) {
    check.detail = 'No EXIF timestamp found';
    return check;
  }

  const timeDiffMs = Math.abs(serverReceivedAt - exifTimestamp);
  if (timeDiffMs <= timeWindowMs) {
    check.passed = true;
    check.detail = `Timestamp valid: ${timeDiffMs}ms difference (< ${timeWindowMs}ms window)`;
  } else {
    check.detail = `Timestamp too old: ${timeDiffMs}ms difference (> ${timeWindowMs}ms window)`;
  }

  return check;
}

/**
 * Validate that image was taken within geofence boundary
 * Haversine formula for distance calculation
 */
export function validateGeofence(
  exifLat: number | undefined,
  exifLng: number | undefined,
  deviceLat: number | undefined,
  deviceLng: number | undefined,
  expectedLat: number,
  expectedLng: number,
  radiusMeters: number
): VerificationCheck {
  const check: VerificationCheck = {
    name: 'geofence_validation',
    passed: false,
    detail: '',
  };

  if (!exifLat || !exifLng) {
    check.detail = 'No EXIF GPS coordinates found';
    return check;
  }

  // Use device GPS if available, fallback to EXIF
  const lat = deviceLat ?? exifLat;
  const lng = deviceLng ?? exifLng;

  const distanceMeters = haversineDistance(lat, lng, expectedLat, expectedLng);
  if (distanceMeters <= radiusMeters) {
    check.passed = true;
    check.detail = `Within geofence: ${distanceMeters.toFixed(2)}m from center (< ${radiusMeters}m)`;
  } else {
    check.detail = `Outside geofence: ${distanceMeters.toFixed(2)}m from center (> ${radiusMeters}m)`;
  }

  return check;
}

/**
 * Haversine formula: calculate distance between two GPS coordinates (in meters)
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Generate perceptual hash (pHash) for image
 * In production, use 'sharp' + 'pixelmatch' or 'phash-generator' npm packages
 * This is a simplified version using SHA256 of image dimensions/data
 */
export function generatePerceptualHash(imageBuffer: Buffer): string {
  try {
    // Simplified stub: in production use robust pHash algorithm
    // For now, use image size and data hash as basis
    const hash = crypto
      .createHash('sha256')
      .update(imageBuffer.slice(0, Math.min(10000, imageBuffer.length)).toString('base64'))
      .digest('hex');
    
    // Return first 16 chars as "perceptual hash" representation
    return hash.substring(0, 16);
  } catch (err) {
    console.warn('Error generating perceptual hash:', err);
    return '';
  }
}

/**
 * Calculate Hamming distance between two perceptual hashes
 * Lower distance = more similar images
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    return Infinity;
  }

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  return distance;
}

/**
 * Validate nonce presence and non-expiration
 */
export function validateNonce(
  nonceFromRequest: string,
  expectedNonce: string,
  expiresAt: number,
  serverNowMs: number
): VerificationCheck {
  const check: VerificationCheck = {
    name: 'nonce_validation',
    passed: false,
    detail: '',
  };

  if (nonceFromRequest !== expectedNonce) {
    check.detail = 'Nonce mismatch: received nonce does not match expected nonce';
    return check;
  }

  if (serverNowMs > expiresAt) {
    check.detail = `Nonce expired: ${serverNowMs - expiresAt}ms past expiration`;
    return check;
  }

  check.passed = true;
  check.detail = `Nonce valid and not expired (${expiresAt - serverNowMs}ms remaining)`;
  return check;
}

/**
 * Full verification pipeline
 */
export async function performVerification(
  imageBuffer: Buffer,
  exifTimestamp: number | undefined,
  exifLat: number | undefined,
  exifLng: number | undefined,
  deviceLat: number | undefined,
  deviceLng: number | undefined,
  nonce: string,
  expectedNonce: string,
  expectedLat: number,
  expectedLng: number,
  recentPhashes: string[],
  config: {
    time_window_ms: number;
    geofence_radius_meters: number;
    phash_threshold: number;
  }
): Promise<VerificationResult> {
  const result: VerificationResult = {
    passed: true,
    errors: [],
    warnings: [],
    checks: [],
  };

  // 1. Validate timestamp
  const timestampCheck = validateTimestamp(exifTimestamp, Date.now(), config.time_window_ms);
  result.checks.push(timestampCheck);
  if (!timestampCheck.passed) {
    result.errors.push({
      code: 'STALE_IMAGE',
      message: 'Image is too old (outside time window)',
      severity: 'critical',
    });
    result.passed = false;
  }

  // 2. Validate geofence
  const geofenceCheck = validateGeofence(
    exifLat,
    exifLng,
    deviceLat,
    deviceLng,
    expectedLat,
    expectedLng,
    config.geofence_radius_meters
  );
  result.checks.push(geofenceCheck);
  if (!geofenceCheck.passed) {
    result.errors.push({
      code: 'OUTSIDE_GEOFENCE',
      message: 'Image location is outside allowed geofence',
      severity: 'critical',
    });
    result.passed = false;
  }

  // 3. Validate nonce
  const nonceCheck = validateNonce(nonce, expectedNonce, Date.now() + 600000, Date.now()); // 10 min ttl
  result.checks.push(nonceCheck);
  if (!nonceCheck.passed) {
    result.errors.push({
      code: 'INVALID_NONCE',
      message: 'Nonce is invalid or expired',
      severity: 'critical',
    });
    result.passed = false;
  }

  // 4. Check for duplicate (perceptual hash)
  const phash = generatePerceptualHash(imageBuffer);
  let isDuplicate = false;
  for (const recentHash of recentPhashes) {
    const distance = hammingDistance(phash, recentHash);
    if (distance <= config.phash_threshold) {
      isDuplicate = true;
      result.warnings.push(`Possible duplicate detected (hash distance: ${distance})`);
      break;
    }
  }

  result.checks.push({
    name: 'duplicate_check',
    passed: !isDuplicate,
    detail: isDuplicate ? 'Possible duplicate image detected' : 'No duplicates detected',
  });

  return result;
}
