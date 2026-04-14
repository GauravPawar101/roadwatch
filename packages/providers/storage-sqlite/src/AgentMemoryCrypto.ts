import { fromByteArray, toByteArray } from 'base64-js';
import nacl from 'tweetnacl';

export const AGENT_MEMORY_DEK_BYTES = 32;
export const AGENT_MEMORY_NONCE_BYTES = 24;

export function utf8ToBytes(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }

  // Fallback for environments without TextEncoder.
  // Note: this handles BMP safely; for full unicode support TextEncoder is recommended.
  const encoded = unescape(encodeURIComponent(value));
  const out = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) out[i] = encoded.charCodeAt(i);
  return out;
}

export function bytesToUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }

  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return decodeURIComponent(escape(s));
}

export function randomBytes(length: number): Uint8Array {
  const cryptoObj: any = (globalThis as any).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const out = new Uint8Array(length);
    cryptoObj.getRandomValues(out);
    return out;
  }

  return nacl.randomBytes(length);
}

export function b64Encode(bytes: Uint8Array): string {
  return fromByteArray(bytes);
}

export function b64Decode(base64: string): Uint8Array {
  return toByteArray(base64);
}

export function encryptJson(payload: unknown, dek: Uint8Array, nonce: Uint8Array): { nonceB64: string; ciphertextB64: string } {
  const plaintextBytes = utf8ToBytes(JSON.stringify(payload));
  const boxed = nacl.secretbox(plaintextBytes, nonce, dek);
  return { nonceB64: b64Encode(nonce), ciphertextB64: b64Encode(boxed) };
}

export function decryptJson<T>(ciphertextB64: string, nonceB64: string, dek: Uint8Array): T {
  const nonce = b64Decode(nonceB64);
  const boxed = b64Decode(ciphertextB64);
  const opened = nacl.secretbox.open(boxed, nonce, dek);
  if (!opened) {
    throw new Error('AgentMemory: Decryption failed (tampered or wrong key)');
  }
  const json = bytesToUtf8(opened);
  return JSON.parse(json) as T;
}
