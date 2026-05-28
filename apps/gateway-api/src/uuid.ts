import { randomBytes } from 'node:crypto';

function toHex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

export function uuidv7(): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  const b6 = bytes[6] ?? 0;
  const b7 = bytes[7] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x70;
  bytes[7] = (b7 & 0x3f) | 0x80;

  return [
    Array.from(bytes.slice(0, 4), toHex).join(''),
    Array.from(bytes.slice(4, 6), toHex).join(''),
    Array.from(bytes.slice(6, 8), toHex).join(''),
    Array.from(bytes.slice(8, 10), toHex).join(''),
    Array.from(bytes.slice(10, 16), toHex).join('')
  ].join('-');
}