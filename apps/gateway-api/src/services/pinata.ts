import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { getEnv } from '../env.js';

export type PinataUploadResult = {
  cid: string;
  url: string;
  provider: 'pinata' | 'local-fallback';
  hash: string;
};

export async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function uploadFileToPinata(filePath: string, mimeType = 'application/octet-stream'): Promise<PinataUploadResult> {
  const env = getEnv();
  const hash = await sha256File(filePath);

  // If Pinata is not configured, return deterministic local fallback to keep pipeline operational.
  if (!env.PINATA_JWT) {
    const fallbackCid = `bafy${hash.slice(0, 40)}`;
    return {
      cid: fallbackCid,
      url: `${env.PINATA_GATEWAY}/${fallbackCid}`,
      provider: 'local-fallback',
      hash
    };
  }

  const fileBytes = await fs.readFile(filePath);
  const fileName = path.basename(filePath);

  const form = new FormData();
  form.append('file', new Blob([fileBytes], { type: mimeType }), fileName);
  form.append('pinataMetadata', JSON.stringify({ name: fileName, keyvalues: { sha256: hash } }));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PINATA_JWT}`
    },
    body: form
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pinata upload failed: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as { IpfsHash?: string };
  const cid = payload.IpfsHash;
  if (!cid) throw new Error('Pinata upload response missing IpfsHash');

  return {
    cid,
    url: `${env.PINATA_GATEWAY}/${cid}`,
    provider: 'pinata',
    hash
  };
}
