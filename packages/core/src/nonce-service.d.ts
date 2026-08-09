/**
 * Nonce Service
 * Manages short-lived server nonces to prevent stale and replayed image uploads
 */
export interface NonceConfig {
    ttl_seconds: number;
    nonce_length_bytes: number;
}
/**
 * Generate a random server nonce
 */
export declare function generateNonce(config: NonceConfig): string;
/**
 * Create nonce record with expiration
 */
export declare function createNonceRecord(userId: string, requestId: string, config: NonceConfig): {
    nonce: string;
    issued_at: number;
    expires_at: number;
};
/**
 * Validate nonce freshness
 */
export declare function isNonceFresh(issued_at: number, expires_at: number, nowMs?: number): boolean;
/**
 * Calculate time remaining on nonce (in milliseconds)
 */
export declare function getTimeRemaining(expires_at: number, nowMs?: number): number;
/**
 * Embed nonce into overlay text for image verification
 * This creates the text that should be rendered as a watermark on the camera preview
 */
export declare function generateNonceOverlayText(nonce: string, timestamp: number): string;
/**
 * Verify that nonce overlay text is present in image (via OCR or pixel verification)
 * Implements OCR-based text detection using a simplified approach
 */
export declare function verifyNonceOverlayInImage(imageBuffer: Buffer, expectedNonce: string, timestamp: number): Promise<{
    overlayDetected: boolean;
    confidence: number;
    detail: string;
}>;
/**
 * Alternative pixel-based verification for nonce overlay
 * Checks specific pixel regions where overlay should be rendered
 */
export declare function verifyNonceOverlayByPixels(imageBuffer: Buffer, expectedNonce: string, overlayPosition: {
    x: number;
    y: number;
    width: number;
    height: number;
}): Promise<{
    overlayDetected: boolean;
    confidence: number;
    detail: string;
}>;
/**
 * Rate-limit nonce generation per user (prevent abuse)
 */
export declare function canGenerateNonce(userNonceCount: number, lastNonceGeneratedAt: number, maxNoncesPerMinute?: number): {
    allowed: boolean;
    reason?: string;
    backoff_ms?: number;
};
/**
 * Generate a secure signature for request payload (optional extra validation)
 * Combines nonce + timestamp + image hash for HMAC verification
 */
export declare function generatePayloadSignature(nonce: string, timestamp: number, imageHash: string, deviceId: string, secretKey: string): string;
/**
 * Verify payload signature
 */
export declare function verifyPayloadSignature(nonce: string, timestamp: number, imageHash: string, deviceId: string, providedSignature: string, secretKey: string): boolean;
/**
 * Cleanup: Remove expired nonces from database
 * Run periodically via background job
 */
export declare function getCleanupQuery(olderThanMs?: number): {
    where: Record<string, unknown>;
};
//# sourceMappingURL=nonce-service.d.ts.map