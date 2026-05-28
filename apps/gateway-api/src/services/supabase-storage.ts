import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { getEnv } from '../env.js';

export type SupabaseStorageUploadResult = {
  cid: string;
  url: string;
  provider: 'supabase-storage' | 'local-fallback';
  hash: string;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function buildObjectKey(fileName: string, hash: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `complaints/${hash}-${safeName}`;
}

function encodeObjectKey(objectKey: string): string {
  return objectKey.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

export async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function uploadFileToSupabaseStorage(filePath: string, mimeType = 'application/octet-stream'): Promise<SupabaseStorageUploadResult> {
  const env = getEnv();
  const hash = await sha256File(filePath);
  const fileBytes = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const bucket = env.SUPABASE_STORAGE_BUCKET ?? 'roadwatch-media';
  const objectKey = buildObjectKey(fileName, hash);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return {
      cid: objectKey,
      url: `supabase-local://${bucket}/${objectKey}`,
      provider: 'local-fallback',
      hash
    };
  }

  const uploadUrl = `${trimTrailingSlash(env.SUPABASE_URL)}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectKey(objectKey)}`;

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      apikey: env.SUPABASE_ANON_KEY,
      'Content-Type': mimeType,
      'x-upsert': 'true'
    },
    body: fileBytes
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase Storage upload failed: ${response.status} ${body}`);
  }

  return {
    cid: objectKey,
    url: `${trimTrailingSlash(env.SUPABASE_URL)}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeObjectKey(objectKey)}`,
    provider: 'supabase-storage',
    hash
  };
}