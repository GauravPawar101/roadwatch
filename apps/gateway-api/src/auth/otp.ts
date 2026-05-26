import { getRedisClient } from '@roadwatch/redis';
import bcrypt from 'bcryptjs';
import { getEnv } from '../env.js';
import { encryptPhone, hashPhone, maskPhone, normalizePhone, phoneLast4 } from '../security/phone.js';

export type OtpPurpose = 'AUTHORITY' | 'CONTRACTOR' | 'CITIZEN';

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function requestOtp(phone: string, purpose: OtpPurpose): Promise<{ ok: true; devCode?: string } | { ok: false; error: string }> {
  const normalized = normalizePhone(phone);
  const phoneHash = hashPhone(normalized);
  const masked = maskPhone(normalized);
  const last4 = phoneLast4(normalized);
  const enc = (() => {
    try {
      return encryptPhone(normalized);
    } catch {
      return null;
    }
  })();

  const redis = getRedisClient();

  // Rate limiting: otp_rate:{phone_hash} TTL 900s (15 minutes)
  const rateKey = `otp_rate:${phoneHash}`;
  const rateCount = await redis.incr(rateKey);
  if (rateCount === 1) {
    await redis.expire(rateKey, 900);
  }
  if (rateCount > 3) {
    return { ok: false, error: 'Rate limit exceeded. Please try again in 15 minutes.' };
  }

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const ttlSeconds = getEnv().OTP_TTL_SECONDS;

  const key = `otp:${phoneHash}`;
  const payload: any = {
    purpose,
    phone_hash: phoneHash,
    phone_enc: enc,
    phone_last4: last4,
    phone: masked,
    code_hash: codeHash,
    attempts: 0,
    created_at: Date.now(),
    expires_at: Date.now() + (ttlSeconds * 1000)
  };

  // Store OTP in Redis with TTL
  await (redis as any).set(String(key), String(JSON.stringify(payload)));
  await redis.expire(key, ttlSeconds);

  // Send OTP via SMS
  try {
    const { sendViaChannel } = await import('../notifications/providers.js');
    await sendViaChannel({
      channel: 'SMS',
      phone: normalized,
      title: 'RoadWatch OTP',
      body: `Your verification code is: ${code}. Valid for ${Math.floor(ttlSeconds / 60)} minutes.`,
      data: { purpose, otp_code: code },
      userId: phoneHash, // Use phone hash as temporary user ID
      district: null,
      zone: null,
      roadId: null
    });
    console.log(`[OTP] SMS sent to ${masked}, expires in ${ttlSeconds}s`);
  } catch (smsError) {
    console.error(`[OTP] SMS failed for ${masked}:`, smsError);
    // Continue execution - OTP is still valid even if SMS fails
  }
  // In development, return the dev code in the response only for known test numbers.
  if (getEnv().NODE_ENV !== 'production') {
    try {
      // Read test-acc.txt at repo root and extract phone numbers to allow dev echo only for them
      const { readFile } = await import('fs/promises');
      const raw = await readFile(new URL('../../test-acc.txt', import.meta.url), 'utf8');
      const phones: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/\+?\d{10,15}/g);
        if (m) phones.push(...m.map((p) => normalizePhone(p)));
      }
      if (phones.includes(normalizePhone(normalized))) {
        return { ok: true, devCode: code };
      }
    } catch (err) {
      // ignore file read errors and fall back to not returning dev code
    }
  }

  return { ok: true };
}

export async function verifyOtp(params: { phone: string; code: string; purpose: OtpPurpose; sessionId?: string }): Promise<boolean> {
  const normalized = normalizePhone(params.phone);
  const phoneHash = hashPhone(normalized);

  const redis = getRedisClient();
  const key = `otp:${phoneHash}`;
  const raw = await redis.get(key);
  if (!raw) return false;
  let row: any;
  try {
    row = JSON.parse(String(raw));
  } catch {
    return false;
  }
  if (row.purpose !== params.purpose) return false;

  const ok = await bcrypt.compare(params.code, row.code_hash);
  if (ok) {
    await redis.del(key);
    return true;
  }

  // Wrong code: increment attempts, delete on too many attempts
  row.attempts = (row.attempts || 0) + 1;
  if (row.attempts > 3) {
    await redis.del(key);
    return false;
  }

  // Preserve remaining TTL when updating attempts
  let ttl = await redis.ttl(key);
  if (typeof ttl !== 'number' || ttl <= 0) ttl = getEnv().OTP_TTL_SECONDS;
  await (redis as any).set(String(key), String(JSON.stringify(row)));
  await redis.expire(key, ttl);
  return false;
}

export async function getOtpStatus(phone: string, purpose: OtpPurpose): Promise<{ exists: boolean; attemptsLeft: number; ttlSeconds: number } | null> {
  const normalized = normalizePhone(phone);
  const phoneHash = hashPhone(normalized);

  const redis = getRedisClient();
  const key = `otp:${phoneHash}`;
  const raw = await redis.get(key);
  if (!raw) return null;

  let row: any;
  try {
    row = JSON.parse(String(raw));
  } catch {
    return null;
  }

  if (row.purpose !== purpose) return null;

  const ttl = await redis.ttl(key);
  const attempts = row.attempts || 0;
  const attemptsLeft = Math.max(0, 3 - attempts);

  return {
    exists: true,
    attemptsLeft,
    ttlSeconds: ttl > 0 ? ttl : 0
  };
}
