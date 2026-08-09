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
export declare function extractExifData(imageBuffer: Buffer): ExifData;
/**
 * Validate that image was taken recently (within time window)
 */
export declare function validateTimestamp(exifTimestamp: number | undefined, serverReceivedAt: number, timeWindowMs: number): VerificationCheck;
/**
 * Validate that image was taken within geofence boundary
 * Haversine formula for distance calculation
 */
export declare function validateGeofence(exifLat: number | undefined, exifLng: number | undefined, deviceLat: number | undefined, deviceLng: number | undefined, expectedLat: number, expectedLng: number, radiusMeters: number): VerificationCheck;
/**
 * Generate perceptual hash (pHash) for image
 * Implements a simplified DCT-based perceptual hashing algorithm
 */
export declare function generatePerceptualHash(imageBuffer: Buffer): string;
/**
 * Calculate Hamming distance between two perceptual hashes
 * Lower distance = more similar images
 */
export declare function hammingDistance(hash1: string, hash2: string): number;
/**
 * Validate nonce presence and non-expiration
 */
export declare function validateNonce(nonceFromRequest: string, expectedNonce: string, expiresAt: number, serverNowMs: number): VerificationCheck;
/**
 * Full verification pipeline
 */
export declare function performVerification(imageBuffer: Buffer, exifTimestamp: number | undefined, exifLat: number | undefined, exifLng: number | undefined, deviceLat: number | undefined, deviceLng: number | undefined, nonce: string, expectedNonce: string, expectedLat: number, expectedLng: number, recentPhashes: string[], config: {
    time_window_ms: number;
    geofence_radius_meters: number;
    phash_threshold: number;
}): Promise<VerificationResult>;
//# sourceMappingURL=verification-service.d.ts.map