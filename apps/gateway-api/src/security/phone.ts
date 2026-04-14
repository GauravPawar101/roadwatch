import crypto from 'node:crypto';
import { getEnv } from '../env.js';

export function normalizePhone(input: string): string {
  const trimmed = String(input ?? '').trim();
  const cleaned = trimmed.replace(/[\s\-()]/g, '');
  if (!cleaned) return cleaned;
  if (cleaned.startsWith('+')) return cleaned;
  // Best-effort: treat as already E.164 without '+'.
  return `+${cleaned}`;
}

export function phoneLast4(input: string): string {
  const digits = normalizePhone(input).replace(/\D/g, '');
  return digits.slice(-4).padStart(4, '*');
}

export function maskPhone(input: string): string {
  const normalized = normalizePhone(input);
  if (!normalized) return '';
  const digits = normalized.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
  const maskedLocal = `******${last4}`;
  return cc ? `+${cc}${maskedLocal}` : `+${maskedLocal}`;
}

export function hashPhone(input: string): string {
  const env = getEnv();
  const pepper = env.PHONE_HASH_PEPPER;
  if (env.NODE_ENV === 'production' && !pepper) {
    throw new Error('PHONE_HASH_PEPPER is required in production');
  }
  const secret = pepper ?? 'dev_phone_hash_pepper_change_me';
  const normalized = normalizePhone(input);
  return crypto.createHmac('sha256', secret).update(normalized, 'utf8').digest('hex');
}

// AES-256-GCM with random IV. Stored as base64: iv.tag.ciphertext
export function encryptPhone(input: string): string {
  const env = getEnv();
  const keyB64 = env.PHONE_ENC_KEY;
  if (!keyB64) {
    if (env.NODE_ENV === 'production') throw new Error('PHONE_ENC_KEY is required in production');
    // Dev fallback: do not encrypt.
    return `plain.${Buffer.from(normalizePhone(input), 'utf8').toString('base64')}`;
  }

  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('PHONE_ENC_KEY must be base64 for 32 bytes');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalizePhone(input), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptPhone(enc: string): string {
  const env = getEnv();
  if (!enc) return '';

  if (enc.startsWith('plain.')) {
    const b64 = enc.slice('plain.'.length);
    return Buffer.from(b64, 'base64').toString('utf8');
  }

  const keyB64 = env.PHONE_ENC_KEY;
  if (!keyB64) {
    if (env.NODE_ENV === 'production') throw new Error('PHONE_ENC_KEY is required in production');
    // Dev fallback: if it isn't plain.*, assume it's already plaintext.
    return enc;
  }

  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('PHONE_ENC_KEY must be base64 for 32 bytes');

  const parts = enc.split('.');
  const [ivB64, tagB64, ctB64] = parts;
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Invalid encrypted phone format');

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return plaintext;
}
