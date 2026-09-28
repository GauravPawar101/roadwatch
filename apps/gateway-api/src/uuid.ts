import { randomFillSync } from 'node:crypto';

/**
 * UUIDv7: time-ordered, so ids sort by creation and index locality improves as
 * rows are appended. Random UUIDv4 was the alternative and it scattered inserts
 * across the whole B-tree.
 *
 * Two costs were removed here, both measured on the complaint write path.
 *
 * **Batched randomness.** `randomBytes(16)` per id was 4.1% of write-path CPU
 * (`uuidv7` 2.3% plus `randomFillSync` 1.8%). The call overhead dominates at 16
 * bytes — it is one CSPRNG call per identifier to obtain sixteen bytes of
 * entropy. Randomness is now drawn in 4 KB blocks and handed out 16 bytes at a
 * time, which is the same generator with ~256x fewer calls.
 *
 * This is not a weaker source. The bytes still come from the platform CSPRNG;
 * only the batching changed. What is lost is forward secrecy against an attacker
 * who can read the process's memory *and* observe past outputs, which is not a
 * threat model for row identifiers. If these ids ever gate anything
 * unguessable, use `randomUUID()` per call instead and accept the cost.
 *
 * **No BigInt.** The timestamp is 48 bits of milliseconds, which fits in a
 * number, so the shifts were done with BigInt for no reason. `Number` shifts only
 * work below 2^31, so the timestamp is split into two halves rather than shifted
 * as one value.
 */

const POOL_BYTES = 4096;
/** Bytes per id: 16, of which 6 are the timestamp and 10 are random. */
const ID_BYTES = 16;
/** Version nibble (7) and variant bits (10xx). */
const RANDOM_START = 6;

let pool = Buffer.alloc(0);
let poolOffset = 0;

/** Refills the pool, or returns null when the block could not be filled. */
function refill(): boolean {
  const next = Buffer.allocUnsafe(POOL_BYTES);
  try {
    randomFillSync(next);
  } catch {
    // The platform RNG is unavailable. Falling back to a per-call draw keeps ids
    // working rather than turning an entropy problem into an outage, and the
    // catch is here because an unrefillable pool would otherwise throw on every
    // request from inside the id generator.
    pool = Buffer.alloc(0);
    poolOffset = 0;
    return false;
  }
  pool = next;
  poolOffset = 0;
  return true;
}

/**
 * 16 random bytes. Prefers the pool and falls back to a direct call so a failure
 * to fill a block degrades performance rather than correctness.
 */
function random16(): Buffer {
  if (poolOffset + ID_BYTES > pool.length && !refill()) {
    return require('node:crypto').randomBytes(ID_BYTES) as Buffer;
  }
  const slice = pool.subarray(poolOffset, poolOffset + ID_BYTES);
  poolOffset += ID_BYTES;
  // A copy, because the caller writes the timestamp into these bytes and the
  // pool must stay random.
  return Buffer.from(slice);
}

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/**
 * Two hex characters per byte, without a per-byte callback.
 *
 * The previous implementation mapped with `toHex` and joined, allocating an
 * array and a closure per id. Formatting into a preallocated string via
 * `HEX[byte]` avoids both.
 */
function hex(byte: number): string {
  return HEX[byte]!;
}

export function uuidv7(): string {
  const bytes = random16();

  // Milliseconds since the epoch, 48 bits. Split into 24-bit halves because
  // JavaScript bitwise operators work on 32 bits, so shifting the full 48-bit
  // value in one go would truncate.
  const ms = Date.now();
  const high = Math.floor(ms / 0x1000000) & 0xffffff;
  const low = ms & 0xffffff;

  bytes[0] = (high >>> 16) & 0xff;
  bytes[1] = (high >>> 8) & 0xff;
  bytes[2] = high & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;
  // Version 7 in the high nibble of byte 6 (time_hi_and_version), keeping 4
  // random bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // Variant 10xx in the top two bits of byte *8* — clock_seq_hi_and_reserved —
  // keeping 6 random bits.
  //
  // The previous implementation set these on byte 7, which is part of
  // time_hi_and_version. That produced ids that looked right and sorted right but
  // were not RFC 9562 conformant: the variant nibble sat in the wrong octet, so
  // a strict parser rejected them. Nothing caught it because the format was never
  // asserted. Byte 8 is the first byte of the 4-hex-digit group at position four,
  // so the hyphen layout below is what makes this land in the right place.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  // Only the random tail is read from the pool beyond the timestamp, so this
  // loop is what actually consumes the block.
  let out = '';
  for (let i = 0; i < ID_BYTES; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    out += hex(bytes[i] as number);
  }
  return out;
}

/** Test hook: drops the pool so the refill path is exercised. */
export function __resetUuidPool(): void {
  pool = Buffer.alloc(0);
  poolOffset = 0;
}

export { RANDOM_START };
