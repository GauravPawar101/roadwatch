import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { getEnv } from '../env.js';
import { encryptPhone, hashPhone, maskPhone, normalizePhone, phoneLast4 } from '../security/phone.js';

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function requestOtp(phone: string): Promise<{ sessionId: string; devCode?: string }> {
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

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + getEnv().OTP_TTL_SECONDS * 1000);

  const r = await pool.query<{ id: string }>(
    `INSERT INTO otp_sessions (phone_hash, phone_enc, phone_last4, phone, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id;`,
    [phoneHash, enc, last4, masked, codeHash, expiresAt]
  );
  const sessionId = r.rows[0]!.id;

  // TODO: SMS integration. For now, log.
  console.log(`[OTP] phone=${masked} code=${code} session=${sessionId} expires=${expiresAt.toISOString()}`);

  if (getEnv().NODE_ENV !== 'production' && getEnv().ALLOW_DEV_OTP_ECHO) {
    return { sessionId, devCode: code };
  }
  return { sessionId };
}

export async function verifyOtp(params: { phone: string; sessionId: string; code: string }): Promise<boolean> {
  const normalized = normalizePhone(params.phone);
  const phoneHash = hashPhone(normalized);

  const r = await pool.query<{ code_hash: string; expires_at: Date; used: boolean }>(
    `SELECT code_hash, expires_at, used FROM otp_sessions WHERE id = $1 AND phone_hash = $2 LIMIT 1;`,
    [params.sessionId, phoneHash]
  );
  const row = r.rows[0];
  if (!row) return false;
  if (row.used) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;

  const ok = await bcrypt.compare(params.code, row.code_hash);
  if (!ok) return false;

  await pool.query(`UPDATE otp_sessions SET used = true WHERE id = $1;`, [params.sessionId]);
  return true;
}
