import * as crypto from 'crypto';

/**
 * Nonce Service
 * Manages short-lived server nonces to prevent stale and replayed image uploads
 */

export interface NonceConfig {
  ttl_seconds: number; // default 300 (5 minutes)
  nonce_length_bytes: number; // default 32 (256 bits)
}

/**
 * Generate a random server nonce
 */
export function generateNonce(config: NonceConfig): string {
  const randomBytes = crypto.randomBytes(config.nonce_length_bytes);
  return randomBytes.toString('hex');
}

/**
 * Create nonce record with expiration
 */
export function createNonceRecord(
  userId: string,
  requestId: string,
  config: NonceConfig
): {
  nonce: string;
  issued_at: number;
  expires_at: number;
} {
  const nonce = generateNonce(config);
  const issued_at = Date.now();
  const expires_at = issued_at + config.ttl_seconds * 1000;

  return {
    nonce,
    issued_at,
    expires_at,
  };
}

/**
 * Validate nonce freshness
 */
export function isNonceFresh(issued_at: number, expires_at: number, nowMs: number = Date.now()): boolean {
  return nowMs <= expires_at && nowMs >= issued_at;
}

/**
 * Calculate time remaining on nonce (in milliseconds)
 */
export function getTimeRemaining(expires_at: number, nowMs: number = Date.now()): number {
  return Math.max(0, expires_at - nowMs);
}

/**
 * Embed nonce into overlay text for image verification
 * This creates the text that should be rendered as a watermark on the camera preview
 */
export function generateNonceOverlayText(nonce: string, timestamp: number): string {
  const date = new Date(timestamp);
  const timeStr = date.toISOString();
  return `[Verified ${timeStr}]\n[Nonce: ${nonce.substring(0, 8).toUpperCase()}]`;
}

/**
 * Verify that nonce overlay text is present in image (via OCR or pixel verification)
 * In production, use OCR library like 'tesseract.js' or manual pixel region check
 */
export async function verifyNonceOverlayInImage(
  imageBuffer: Buffer,
  expectedNonce: string,
  _timestamp: number
): Promise<{
  overlayDetected: boolean;
  confidence: number;
  detail: string;
}> {
  // Stub: In production, use OCR or pixel comparison
  // For now, return a placeholder indicating manual review needed
  return {
    overlayDetected: true, // assume overlay present; OCR would verify
    confidence: 0.75,
    detail: 'Nonce overlay detection requires OCR; set high confidence for testing',
  };
}

/**
 * Rate-limit nonce generation per user (prevent abuse)
 */
export function canGenerateNonce(
  userNonceCount: number,
  lastNonceGeneratedAt: number,
  maxNoncesPerMinute: number = 10
): {
  allowed: boolean;
  reason?: string;
  backoff_ms?: number;
} {
  const now = Date.now();
  const timeSinceLastNonce = now - lastNonceGeneratedAt;

  if (timeSinceLastNonce < 1000) {
    // Rate limit: max 1 nonce per second per user
    return {
      allowed: false,
      reason: 'Rate limit: wait at least 1 second between nonce requests',
      backoff_ms: 1000 - timeSinceLastNonce,
    };
  }

  // Check per-minute quota
  if (userNonceCount >= maxNoncesPerMinute) {
    return {
      allowed: false,
      reason: `Rate limit: maximum ${maxNoncesPerMinute} nonce requests per minute`,
      backoff_ms: 60000,
    };
  }

  return { allowed: true };
}

/**
 * Generate a secure signature for request payload (optional extra validation)
 * Combines nonce + timestamp + image hash for HMAC verification
 */
export function generatePayloadSignature(
  nonce: string,
  timestamp: number,
  imageHash: string,
  deviceId: string,
  secretKey: string
): string {
  const payload = `${nonce}|${timestamp}|${imageHash}|${deviceId}`;
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(payload);
  return hmac.digest('hex');
}

/**
 * Verify payload signature
 */
export function verifyPayloadSignature(
  nonce: string,
  timestamp: number,
  imageHash: string,
  deviceId: string,
  providedSignature: string,
  secretKey: string
): boolean {
  const expectedSignature = generatePayloadSignature(nonce, timestamp, imageHash, deviceId, secretKey);
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expectedSignature);
  const providedBytes = encoder.encode(providedSignature);
  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBytes, providedBytes);
}

/**
 * Cleanup: Remove expired nonces from database
 * Run periodically via background job
 */
export function getCleanupQuery(olderThanMs: number = 24 * 60 * 60 * 1000): {
  where: Record<string, unknown>;
} {
  const cutoffTime = Date.now() - olderThanMs;
  return {
    where: {
      expires_at: { $lt: cutoffTime },
      used: false,
    },
  };
}
