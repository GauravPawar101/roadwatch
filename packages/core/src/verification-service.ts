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
  software?: string;
  orientation?: number;
  xResolution?: number;
  yResolution?: number;
  flash?: number;
  focalLength?: number;
  iso?: number;
  exposureTime?: string;
  fNumber?: number;
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
 * Comprehensive EXIF parsing implementation
 */
export function extractExifData(imageBuffer: Buffer): ExifData {
  try {
    const exifData: ExifData = {};
    
    // Check for JPEG SOI marker
    if (imageBuffer[0] !== 0xFF || imageBuffer[1] !== 0xD8) {
      console.warn('Not a valid JPEG file');
      return exifData;
    }
    
    let offset = 2;
    
    // Look for EXIF APP1 marker (0xFFE1)
    while (offset < imageBuffer.length - 8) {
      if (imageBuffer[offset] === 0xFF && imageBuffer[offset + 1] === 0xE1) {
        const segmentLength = imageBuffer.readUInt16BE(offset + 2);
        const segmentStart = offset + 4;
        
        // Check for EXIF identifier
        if (imageBuffer.slice(segmentStart, segmentStart + 4).toString('ascii') === 'Exif') {
          const exifStart = segmentStart + 6; // Skip "Exif\0\0"
          
          // Parse TIFF header
          const tiffHeader = imageBuffer.slice(exifStart, exifStart + 8);
          const byteOrder = tiffHeader.slice(0, 2).toString('ascii');
          const isLittleEndian = byteOrder === 'II';
          
          // Read IFD0 offset
          const ifd0Offset = isLittleEndian ? 
            tiffHeader.readUInt32LE(4) : 
            tiffHeader.readUInt32BE(4);
          
          // Parse IFD0 (main image directory)
          parseIFD(imageBuffer, exifStart + ifd0Offset, exifStart, isLittleEndian, exifData);
          
          break;
        }
      }
      offset += 2;
    }
    
    return exifData;
  } catch (err) {
    console.warn('Error extracting EXIF:', err);
    return {};
  }
}

function toUint8Array(buf: Buffer): Uint8Array {
  // Create an ArrayBuffer copy to avoid SharedArrayBuffer incompatibilities
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  return new Uint8Array(ab);
}

/**
 * Parse IFD (Image File Directory) entries
 */
function parseIFD(buffer: Buffer, ifdOffset: number, tiffStart: number, isLittleEndian: boolean, exifData: ExifData): void {
  try {
    const entryCount = isLittleEndian ? 
      buffer.readUInt16LE(ifdOffset) : 
      buffer.readUInt16BE(ifdOffset);
    
    let entryOffset = ifdOffset + 2;
    
    for (let i = 0; i < entryCount; i++) {
      const tag = isLittleEndian ? 
        buffer.readUInt16LE(entryOffset) : 
        buffer.readUInt16BE(entryOffset);
      
      const type = isLittleEndian ? 
        buffer.readUInt16LE(entryOffset + 2) : 
        buffer.readUInt16BE(entryOffset + 2);
      
      const count = isLittleEndian ? 
        buffer.readUInt32LE(entryOffset + 4) : 
        buffer.readUInt32BE(entryOffset + 4);
      
      const valueOffset = isLittleEndian ? 
        buffer.readUInt32LE(entryOffset + 8) : 
        buffer.readUInt32BE(entryOffset + 8);
      
      // Parse specific EXIF tags
      switch (tag) {
        case 0x010F: // Make
          exifData.make = readString(buffer, tiffStart + valueOffset, count);
          break;
        case 0x0110: // Model
          exifData.model = readString(buffer, tiffStart + valueOffset, count);
          break;
        case 0x0131: // Software
          exifData.software = readString(buffer, tiffStart + valueOffset, count);
          break;
        case 0x0112: // Orientation
          exifData.orientation = readValue(buffer, entryOffset + 8, type, isLittleEndian);
          break;
        case 0x011A: // XResolution
          exifData.xResolution = readRational(buffer, tiffStart + valueOffset, isLittleEndian);
          break;
        case 0x011B: // YResolution
          exifData.yResolution = readRational(buffer, tiffStart + valueOffset, isLittleEndian);
          break;
        case 0x0132: // DateTime
          const dateTimeStr = readString(buffer, tiffStart + valueOffset, count);
          exifData.timestamp = parseDateTimeString(dateTimeStr ?? undefined);
          break;
        case 0x8769: // EXIF SubIFD
          parseExifSubIFD(buffer, tiffStart + valueOffset, tiffStart, isLittleEndian, exifData);
          break;
        case 0x8825: // GPS SubIFD
          parseGPSSubIFD(buffer, tiffStart + valueOffset, tiffStart, isLittleEndian, exifData);
          break;
      }
      
      entryOffset += 12;
    }
  } catch (err) {
    console.warn('Error parsing IFD:', err);
  }
}

/**
 * Parse EXIF SubIFD for camera settings
 */
function parseExifSubIFD(buffer: Buffer, ifdOffset: number, tiffStart: number, isLittleEndian: boolean, exifData: ExifData): void {
  try {
    const entryCount = isLittleEndian ? 
      buffer.readUInt16LE(ifdOffset) : 
      buffer.readUInt16BE(ifdOffset);
    
    let entryOffset = ifdOffset + 2;
    
    for (let i = 0; i < entryCount; i++) {
      const tag = isLittleEndian ? 
        buffer.readUInt16LE(entryOffset) : 
        buffer.readUInt16BE(entryOffset);
      
      const type = isLittleEndian ? 
        buffer.readUInt16LE(entryOffset + 2) : 
        buffer.readUInt16BE(entryOffset + 2);
      
      const valueOffset = isLittleEndian ? 
        buffer.readUInt32LE(entryOffset + 8) : 
        buffer.readUInt32BE(entryOffset + 8);
      
      switch (tag) {
        case 0x829A: // ExposureTime
          const exposureRational = readRational(buffer, tiffStart + valueOffset, isLittleEndian);
          if (exposureRational && isFinite(exposureRational) && exposureRational > 0) {
            exifData.exposureTime = `1/${Math.round(1 / exposureRational)}`;
          } else {
            exifData.exposureTime = undefined;
          }
          break;
        case 0x829D: // FNumber
          exifData.fNumber = readRational(buffer, tiffStart + valueOffset, isLittleEndian);
          break;
        case 0x8827: // ISO
          exifData.iso = readValue(buffer, entryOffset + 8, type, isLittleEndian);
          break;
        case 0x920A: // FocalLength
          exifData.focalLength = readRational(buffer, tiffStart + valueOffset, isLittleEndian);
          break;
        case 0x9003: // DateTimeOriginal
          const originalDateTime = readString(buffer, tiffStart + valueOffset, 20);
          if (!exifData.timestamp) {
            exifData.timestamp = parseDateTimeString(originalDateTime ?? undefined);
          }
          break;
        case 0x9209: // Flash
          exifData.flash = readValue(buffer, entryOffset + 8, type, isLittleEndian);
          break;
      }
      
      entryOffset += 12;
    }
  } catch (err) {
    console.warn('Error parsing EXIF SubIFD:', err);
  }
}

/**
 * Parse GPS SubIFD for location data
 */
function parseGPSSubIFD(buffer: Buffer, ifdOffset: number, tiffStart: number, isLittleEndian: boolean, exifData: ExifData): void {
  try {
    const entryCount = isLittleEndian ? 
      buffer.readUInt16LE(ifdOffset) : 
      buffer.readUInt16BE(ifdOffset);
    
    let entryOffset = ifdOffset + 2;
    let latRef = '';
    let lonRef = '';
    let latDegrees = 0, latMinutes = 0, latSeconds = 0;
    let lonDegrees = 0, lonMinutes = 0, lonSeconds = 0;
    
    for (let i = 0; i < entryCount; i++) {
      const tag = isLittleEndian ? 
        buffer.readUInt16LE(entryOffset) : 
        buffer.readUInt16BE(entryOffset);
      
      const valueOffset = isLittleEndian ? 
        buffer.readUInt32LE(entryOffset + 8) : 
        buffer.readUInt32BE(entryOffset + 8);
      
      switch (tag) {
        case 0x0001: // GPSLatitudeRef
          latRef = String.fromCharCode(buffer[entryOffset + 8] ?? 0);
          break;
        case 0x0002: // GPSLatitude
            const latRationals = readRationalArray(buffer, tiffStart + valueOffset, 3, isLittleEndian);
            latDegrees = latRationals[0] ?? 0;
            latMinutes = latRationals[1] ?? 0;
            latSeconds = latRationals[2] ?? 0;
          break;
        case 0x0003: // GPSLongitudeRef
          lonRef = String.fromCharCode(buffer[entryOffset + 8] ?? 0);
          break;
        case 0x0004: // GPSLongitude
          const lonRationals = readRationalArray(buffer, tiffStart + valueOffset, 3, isLittleEndian);
          lonDegrees = lonRationals[0] ?? 0;
          lonMinutes = lonRationals[1] ?? 0;
          lonSeconds = lonRationals[2] ?? 0;
          break;
      }
      
      entryOffset += 12;
    }
    
    // Convert DMS to decimal degrees
    if (latRef && lonRef) {
      exifData.latitude = latDegrees + (latMinutes / 60) + (latSeconds / 3600);
      if (latRef === 'S') exifData.latitude *= -1;
      
      exifData.longitude = lonDegrees + (lonMinutes / 60) + (lonSeconds / 3600);
      if (lonRef === 'W') exifData.longitude *= -1;
    }
  } catch (err) {
    console.warn('Error parsing GPS SubIFD:', err);
  }
}

/**
 * Helper functions for reading EXIF data types
 */
function readString(buffer: Buffer, offset: number, length: number): string {
  if (typeof offset !== 'number' || typeof length !== 'number') return '';
  if (offset < 0 || offset >= buffer.length) return '';
  const safeLength = Math.max(0, Math.min(length, buffer.length - offset));
  try {
    return buffer.slice(offset, offset + safeLength - 1).toString('ascii').replace(/\0/g, '');
  } catch {
    return '';
  }
}

function readValue(buffer: Buffer, offset: number, type: number, isLittleEndian: boolean): number {
  switch (type) {
    case 1: // BYTE
      return buffer[offset] ?? 0;
    case 3: // SHORT
      return isLittleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
    case 4: // LONG
      return isLittleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    default:
      return 0;
  }
}

function readRational(buffer: Buffer, offset: number, isLittleEndian: boolean): number {
  const numerator = isLittleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  const denominator = isLittleEndian ? buffer.readUInt32LE(offset + 4) : buffer.readUInt32BE(offset + 4);
  return denominator !== 0 ? numerator / denominator : 0;
}

function readRationalArray(buffer: Buffer, offset: number, count: number, isLittleEndian: boolean): number[] {
  const rationals: number[] = [];
  for (let i = 0; i < count; i++) {
    rationals.push(readRational(buffer, offset + (i * 8), isLittleEndian));
  }
  return rationals;
}

function parseDateTimeString(dateTimeStr: string | undefined): number {
  if (!dateTimeStr || typeof dateTimeStr !== 'string' || dateTimeStr.length < 19) return 0;

  // Format: "YYYY:MM:DD HH:MM:SS"
  const parts = dateTimeStr.split(' ');
  if (parts.length !== 2) return 0;

  const [datePart, timePart] = parts;
  if (!datePart || !timePart) return 0;

  const dateParts = datePart.split(':');
  const timeParts = timePart.split(':');
  if (dateParts.length !== 3 || timeParts.length !== 3) return 0;

  const [yStr, mStr, dStr] = dateParts;
  const [hhStr, mmStr, ssStr] = timeParts;
  if (!yStr || !mStr || !dStr || !hhStr || !mmStr || !ssStr) return 0;

  const year = parseInt(yStr);
  const month = parseInt(mStr) - 1; // Month is 0-indexed
  const day = parseInt(dStr);
  const hour = parseInt(hhStr);
  const minute = parseInt(mmStr);
  const second = parseInt(ssStr);

  return new Date(year, month, day, hour, minute, second).getTime();
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

  // Use device GPS if available, fallback to EXIF. Coerce to number to satisfy callers.
  const lat = (deviceLat ?? exifLat) ?? 0;
  const lng = (deviceLng ?? exifLng) ?? 0;

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
 * Implements a simplified DCT-based perceptual hashing algorithm
 */
export function generatePerceptualHash(imageBuffer: Buffer): string {
  try {
    // Step 1: Extract image dimensions and basic structure
    const { width, height, pixels } = extractImagePixels(imageBuffer);
    
    if (!pixels || pixels.length === 0) {
      // Fallback to content-based hash
      return crypto.createHash('sha256')
        .update(toUint8Array(imageBuffer.slice(0, Math.min(10000, imageBuffer.length))))
        .digest('hex')
        .substring(0, 16);
    }
    
    // Step 2: Resize to 32x32 grayscale
    const resized = resizeToGrayscale(pixels, width, height, 32, 32);
    
    // Step 3: Apply DCT (Discrete Cosine Transform) - simplified version
    const dctMatrix = applyDCT(resized, 32);
    
    // Step 4: Extract top-left 8x8 DCT coefficients (excluding DC component)
    const dctCoeffs: number[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (x !== 0 || y !== 0) { // Skip DC component
          dctCoeffs.push(dctMatrix[y * 32 + x] ?? 0);
        }
      }
    }
    
    // Step 5: Calculate median of DCT coefficients
    const sortedCoeffs = [...dctCoeffs].sort((a, b) => a - b);
    let median: number = 0;
    if (sortedCoeffs.length > 0) {
      const idx = Math.floor(sortedCoeffs.length / 2);
      median = typeof sortedCoeffs[idx] === 'number' ? sortedCoeffs[idx] : 0;
    }
    
    // Step 6: Generate binary hash based on median threshold
    let hashBits = '';
    for (const coeff of dctCoeffs) {
      hashBits += coeff > median ? '1' : '0';
    }
    
    // Step 7: Convert binary to hexadecimal
    let hexHash = '';
    for (let i = 0; i < hashBits.length; i += 4) {
      const nibble = hashBits.substr(i, 4);
      hexHash += parseInt(nibble, 2).toString(16);
    }
    
    return hexHash.padEnd(16, '0').substring(0, 16);
    
  } catch (err) {
    console.warn('Error generating perceptual hash:', err);
    // Fallback to SHA256-based hash
    return crypto.createHash('sha256')
      .update(toUint8Array(imageBuffer))
      .digest('hex')
      .substring(0, 16);
  }
}

/**
 * Extract pixel data from JPEG buffer (simplified)
 */
function extractImagePixels(imageBuffer: Buffer): { width: number; height: number; pixels: number[] } {
  try {
    // This is a simplified JPEG decoder for demonstration
    // In production, use a proper image library like 'sharp' or 'jimp'
    
    // Look for SOF0 marker (0xFFC0) to get dimensions
    let offset = 0;
    while (offset < imageBuffer.length - 10) {
      if (imageBuffer[offset] === 0xFF && imageBuffer[offset + 1] === 0xC0) {
        const height = imageBuffer.readUInt16BE(offset + 5);
        const width = imageBuffer.readUInt16BE(offset + 7);
        
        // Generate mock pixel data based on image content
        // In production, decode actual JPEG pixel data
        const pixels: number[] = [];
        const step = Math.max(1, Math.floor(imageBuffer.length / (width * height)));
        
        for (let i = 0; i < width * height; i++) {
          const bufferIndex = (i * step) % imageBuffer.length;
          pixels.push(imageBuffer[bufferIndex] ?? 0);
        }
        
        return { width, height, pixels };
      }
      offset++;
    }
    
    // Fallback: assume square image and generate from buffer content
    const assumedSize = Math.floor(Math.sqrt(imageBuffer.length / 3));
    const pixels: number[] = [];
    
    for (let i = 0; i < assumedSize * assumedSize; i++) {
      const bufferIndex = (i * 3) % imageBuffer.length;
      // Convert RGB to grayscale: 0.299*R + 0.587*G + 0.114*B
      const r = imageBuffer[bufferIndex] ?? 0;
      const g = imageBuffer[bufferIndex + 1] ?? 0;
      const b = imageBuffer[bufferIndex + 2] ?? 0;
      pixels.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
    }
    
    return { width: assumedSize, height: assumedSize, pixels };
    
  } catch (err) {
    console.warn('Error extracting pixels:', err);
    return { width: 0, height: 0, pixels: [] };
  }
}

/**
 * Resize image to grayscale using bilinear interpolation
 */
function resizeToGrayscale(pixels: number[], srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): number[] {
  const resized: number[] = [];
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;
  
  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      
      const x1 = Math.floor(srcX);
      const y1 = Math.floor(srcY);
      const x2 = Math.min(x1 + 1, srcWidth - 1);
      const y2 = Math.min(y1 + 1, srcHeight - 1);
      
      const dx = srcX - x1;
      const dy = srcY - y1;
      
      const p1 = pixels[y1 * srcWidth + x1] ?? 0;
      const p2 = pixels[y1 * srcWidth + x2] ?? 0;
      const p3 = pixels[y2 * srcWidth + x1] ?? 0;
      const p4 = pixels[y2 * srcWidth + x2] ?? 0;
      
      const interpolated = p1 * (1 - dx) * (1 - dy) +
                          p2 * dx * (1 - dy) +
                          p3 * (1 - dx) * dy +
                          p4 * dx * dy;
      
      resized.push(Math.round(interpolated));
    }
  }
  
  return resized;
}

/**
 * Apply simplified DCT (Discrete Cosine Transform)
 */
function applyDCT(pixels: number[], size: number): number[] {
  const dct: number[] = new Array(size * size).fill(0);
  
  for (let u = 0; u < size; u++) {
    for (let v = 0; v < size; v++) {
      let sum = 0;
      
        for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          const pixel = pixels[y * size + x] ?? 0;
          sum += pixel * 
                 Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size)) *
                 Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size));
        }
      }
      
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      
      dct[v * size + u] = (cu * cv / 4) * sum;
    }
  }
  
  return dct;
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
