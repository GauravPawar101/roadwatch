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

  // Build multipart form data in a Node-friendly way. Prefer global FormData if available (Node 18+),
  // otherwise fall back to the lightweight `form-data` package if installed.
  let form: any;
  let headers: Record<string, string> = { Authorization: `Bearer ${env.PINATA_JWT}` };

  if (typeof FormData !== 'undefined' && typeof Blob !== 'undefined') {
    form = new FormData();
    form.append('file', new Blob([fileBytes], { type: mimeType }), fileName);
    form.append('pinataMetadata', JSON.stringify({ name: fileName, keyvalues: { sha256: hash } }));
    form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
    // Let fetch set content-type for native FormData
  } else {
    // Dynamic import to avoid adding hard dependency during tests
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FormDataNode = await import('form-data').then(m => m.default || m);
    form = new FormDataNode();
    form.append('file', fileBytes, { filename: fileName, contentType: mimeType });
    form.append('pinataMetadata', JSON.stringify({ name: fileName, keyvalues: { sha256: hash } }));
    form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
    // `form.getHeaders()` provides required multipart headers
    headers = { ...headers, ...(form.getHeaders ? form.getHeaders() : {}) };
  }

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers,
    // `form` may be a FormData or form-data instance; fetch accepts both in Node 18+, and node-fetch supports form-data.
    body: form as any
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
