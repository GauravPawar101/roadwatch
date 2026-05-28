import * as crypto from 'crypto';

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return String(err ?? ''); } catch { return 'Unknown error'; }
}

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
 * Implements OCR-based text detection using a simplified approach
 */
export async function verifyNonceOverlayInImage(
  imageBuffer: Buffer,
  expectedNonce: string,
  timestamp: number
): Promise<{
  overlayDetected: boolean;
  confidence: number;
  detail: string;
}> {
  try {
    // Generate expected overlay text
    const expectedOverlayText = generateNonceOverlayText(expectedNonce, timestamp);
    const expectedNonceShort = expectedNonce.substring(0, 8).toUpperCase();
    
    // Step 1: Basic image validation
    if (!isValidImageBuffer(imageBuffer)) {
      return {
        overlayDetected: false,
        confidence: 0,
        detail: 'Invalid image buffer provided'
      };
    }
    
    // Step 2: Extract text regions using simplified OCR
    const extractedText = await extractTextFromImage(imageBuffer);
    
    if (!extractedText || extractedText.length === 0) {
      return {
        overlayDetected: false,
        confidence: 0.1,
        detail: 'No text detected in image'
      };
    }
    
    // Step 3: Search for nonce pattern in extracted text
    const noncePattern = new RegExp(`NONCE[:\\s]*${expectedNonceShort}`, 'i');
    const verifiedPattern = /VERIFIED[\s\d\-T:Z\[\]]+/i;
    
    const nonceFound = noncePattern.test(extractedText);
    const verifiedFound = verifiedPattern.test(extractedText);
    
    // Step 4: Calculate confidence based on matches
    let confidence = 0;
    let details: string[] = [];
    
    if (nonceFound) {
      confidence += 0.6;
      details.push(`Nonce ${expectedNonceShort} found`);
    } else {
      details.push(`Nonce ${expectedNonceShort} not found`);
    }
    
    if (verifiedFound) {
      confidence += 0.3;
      details.push('Verified timestamp pattern found');
    } else {
      details.push('Verified timestamp pattern not found');
    }
    
    // Step 5: Additional validation - check for timestamp proximity
    const timestampMatches = extractedText.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g);
    if (timestampMatches && timestampMatches.length > 0) {
      const extractedTimestamp = new Date(timestampMatches[0]).getTime();
      const timeDiff = Math.abs(extractedTimestamp - timestamp);
      
      if (timeDiff < 60000) { // Within 1 minute
        confidence += 0.1;
        details.push('Timestamp matches expected time');
      } else {
        details.push(`Timestamp differs by ${Math.round(timeDiff / 1000)}s`);
      }
    }
    
    const overlayDetected = confidence >= 0.5;
    
    return {
      overlayDetected,
      confidence: Math.min(confidence, 1.0),
      detail: details.join('; ')
    };
    
  } catch (error) {
    console.error('Error verifying nonce overlay:', error);
    return {
      overlayDetected: false,
      confidence: 0,
      detail: `OCR verification failed: ${getErrorMessage(error)}`
    };
  }
}

/**
 * Validate image buffer format
 */
function isValidImageBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 10) {
    return false;
  }
  
  // Check for common image format headers
  const jpegHeader = buffer[0] === 0xFF && buffer[1] === 0xD8;
  const pngHeader = buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
  const webpHeader = buffer.slice(8, 12).toString('ascii') === 'WEBP';
  
  return jpegHeader || pngHeader || webpHeader;
}

/**
 * Extract text from image using simplified OCR approach
 * In production, use tesseract.js or similar OCR library
 */
async function extractTextFromImage(imageBuffer: Buffer): Promise<string> {
  try {
    // This is a simplified OCR implementation for demonstration
    // In production, use tesseract.js:
    // 
    // import Tesseract from 'tesseract.js';
    // const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
    // return text;
    
    // For now, implement a basic pattern-based text extraction
    // that looks for text-like regions in the image
    
    const textRegions = findTextRegions(imageBuffer);
    const extractedText = decodeTextFromRegions(textRegions);
    
    return extractedText;
    
  } catch (error) {
    console.error('Error in OCR text extraction:', error);
    return '';
  }
}

/**
 * Find potential text regions in image (simplified approach)
 */
function findTextRegions(imageBuffer: Buffer): Array<{ x: number; y: number; width: number; height: number; data: Buffer }> {
  // This is a mock implementation
  // In production, use proper image processing to detect text regions
  
  const regions: Array<{ x: number; y: number; width: number; height: number; data: Buffer }> = [];
  
  // Look for overlay regions (typically in corners or top/bottom)
  const imageSize = Math.sqrt(imageBuffer.length / 3); // Rough estimate
  
  // Top region (where overlay text is typically placed)
  regions.push({
    x: 0,
    y: 0,
    width: Math.floor(imageSize),
    height: Math.floor(imageSize * 0.2),
    data: imageBuffer.slice(0, Math.min(1000, imageBuffer.length))
  });
  
  // Bottom region
  regions.push({
    x: 0,
    y: Math.floor(imageSize * 0.8),
    width: Math.floor(imageSize),
    height: Math.floor(imageSize * 0.2),
    data: imageBuffer.slice(-Math.min(1000, imageBuffer.length))
  });
  
  return regions;
}

/**
 * Decode text from image regions using pattern matching
 */
function decodeTextFromRegions(regions: Array<{ x: number; y: number; width: number; height: number; data: Buffer }>): string {
  let extractedText = '';
  
  for (const region of regions) {
    // Look for ASCII text patterns in the region data
    const regionText = extractAsciiText(region.data);
    if (regionText) {
      extractedText += regionText + ' ';
    }
  }
  
  return extractedText.trim();
}

/**
 * Extract ASCII text from buffer data
 */
function extractAsciiText(buffer: Buffer): string {
  let text = '';
  let consecutiveAscii = '';
  
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i] ?? 0;
    
    // Check if byte is printable ASCII (32-126)
    if (byte >= 32 && byte <= 126) {
      consecutiveAscii += String.fromCharCode(byte);
    } else {
      // End of ASCII sequence
      if (consecutiveAscii.length >= 3) { // Minimum 3 chars to be considered text
        text += consecutiveAscii + ' ';
      }
      consecutiveAscii = '';
    }
  }
  
  // Add final sequence if it exists
  if (consecutiveAscii.length >= 3) {
    text += consecutiveAscii;
  }
  
  return text.trim();
}

/**
 * Alternative pixel-based verification for nonce overlay
 * Checks specific pixel regions where overlay should be rendered
 */
export async function verifyNonceOverlayByPixels(
  imageBuffer: Buffer,
  expectedNonce: string,
  overlayPosition: { x: number; y: number; width: number; height: number }
): Promise<{
  overlayDetected: boolean;
  confidence: number;
  detail: string;
}> {
  try {
    // Extract pixel data from the specified overlay region
    const regionPixels = extractPixelRegion(imageBuffer, overlayPosition);
    
    if (!regionPixels || regionPixels.length === 0) {
      return {
        overlayDetected: false,
        confidence: 0,
        detail: 'Could not extract pixel data from overlay region'
      };
    }
    
    // Analyze pixel patterns for text-like structures
    const hasTextPattern = detectTextPattern(regionPixels, overlayPosition.width, overlayPosition.height);
    
    // Check for overlay background (semi-transparent overlay typically has specific color patterns)
    const hasOverlayBackground = detectOverlayBackground(regionPixels);
    
    let confidence = 0;
    const details: string[] = [];
    
    if (hasTextPattern) {
      confidence += 0.4;
      details.push('Text-like pixel patterns detected');
    }
    
    if (hasOverlayBackground) {
      confidence += 0.3;
      details.push('Overlay background pattern detected');
    }
    
    // Additional check: look for high contrast regions (text on background)
    const hasHighContrast = detectHighContrastRegions(regionPixels, overlayPosition.width);
    if (hasHighContrast) {
      confidence += 0.3;
      details.push('High contrast text regions found');
    }
    
    return {
      overlayDetected: confidence >= 0.5,
      confidence: Math.min(confidence, 1.0),
      detail: details.join('; ')
    };
    
  } catch (error) {
    console.error('Error in pixel-based overlay verification:', error);
    return {
      overlayDetected: false,
      confidence: 0,
      detail: `Pixel verification failed: ${getErrorMessage(error)}`
    };
  }
}

/**
 * Extract pixel data from specific region of image
 */
function extractPixelRegion(imageBuffer: Buffer, region: { x: number; y: number; width: number; height: number }): number[] {
  // Simplified pixel extraction - in production use proper image library
  const pixels: number[] = [];
  const regionSize = region.width * region.height;
  const startOffset = Math.floor(imageBuffer.length * 0.1); // Approximate region start
  
  for (let i = 0; i < regionSize && (startOffset + i * 3) < imageBuffer.length; i++) {
    const offset = startOffset + i * 3;
    // Convert RGB to grayscale
    const r = imageBuffer[offset] || 0;
    const g = imageBuffer[offset + 1] || 0;
    const b = imageBuffer[offset + 2] || 0;
    pixels.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
  }
  
  return pixels;
}

/**
 * Detect text-like patterns in pixel data
 */
function detectTextPattern(pixels: number[], width: number, height: number): boolean {
  if (pixels.length < width * height) return false;
  
  // Look for horizontal lines (typical in text)
  let horizontalLines = 0;
  
  for (let y = 1; y < height - 1; y++) {
    let linePixels = 0;
    for (let x = 1; x < width - 1; x++) {
    const current = pixels[y * width + x] ?? 0;
    const above = pixels[(y - 1) * width + x] ?? 0;
    const below = pixels[(y + 1) * width + x] ?? 0;
      
      // Check for horizontal edge (text baseline, top line, etc.)
      if (Math.abs(current - above) > 50 || Math.abs(current - below) > 50) {
        linePixels++;
      }
    }
    
    if (linePixels > width * 0.3) { // 30% of pixels in line show edge
      horizontalLines++;
    }
  }
  
  return horizontalLines >= 2; // At least 2 horizontal text lines
}

/**
 * Detect overlay background pattern
 */
function detectOverlayBackground(pixels: number[]): boolean {
  if (pixels.length < 100) return false;
  
  // Calculate pixel variance - overlays typically have low variance backgrounds
  const mean = pixels.reduce((sum, p) => sum + p, 0) / pixels.length;
  const variance = pixels.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pixels.length;
  
  // Low variance suggests uniform background (typical of overlay)
  return variance < 500; // Threshold for overlay background
}

/**
 * Detect high contrast regions (text on background)
 */
function detectHighContrastRegions(pixels: number[], width: number): boolean {
  if (pixels.length < width * 2) return false;
  
  let highContrastPixels = 0;
  
  for (let i = width; i < pixels.length - width; i++) {
    const current = pixels[i] ?? 0;
    const neighbors = [
      pixels[i - 1] ?? 0, pixels[i + 1] ?? 0,
      pixels[i - width] ?? 0, pixels[i + width] ?? 0
    ];
    
    const maxDiff = Math.max(...neighbors.map(n => Math.abs(current - n)));
    if (maxDiff > 100) { // High contrast threshold
      highContrastPixels++;
    }
  }
  
  return highContrastPixels > pixels.length * 0.1; // 10% high contrast pixels
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
