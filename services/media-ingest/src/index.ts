import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { extractExifData, performVerification, type VerificationResult } from '@roadwatch/core/verification-service.js';
import { pool } from '../../gateway-api/src/postgres.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const PORT = process.env.MEDIA_INGEST_PORT ?? 4000;

app.use(express.json({ limit: '10mb' }));

function getEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

app.post('/media/verify', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'image file is required' });
    }

    const {
      expectedLat,
      expectedLng,
      geofenceRadiusMeters = '50',
      timeWindowMs = '300000',
      phashThreshold = '8',
      nonce,
      expectedNonce,
    } = req.body;

    if (!expectedLat || !expectedLng) {
      return res.status(400).json({ error: 'expectedLat and expectedLng are required' });
    }

    const imageBuffer = req.file.buffer;
    const exifData = extractExifData(imageBuffer);

    const result: VerificationResult = await performVerification(
      imageBuffer,
      exifData.timestamp,
      exifData.latitude,
      exifData.longitude,
      undefined,
      undefined,
      nonce ?? '',
      expectedNonce ?? '',
      Number(expectedLat),
      Number(expectedLng),
      [],
      {
        time_window_ms: Number(timeWindowMs),
        geofence_radius_meters: Number(geofenceRadiusMeters),
        phash_threshold: Number(phashThreshold),
      }
    );

    res.json({
      ok: result.passed,
      exif: {
        timestamp: exifData.timestamp,
        latitude: exifData.latitude,
        longitude: exifData.longitude,
        make: exifData.make,
        model: exifData.model,
      },
      checks: result.checks,
      errors: result.errors,
      warnings: result.warnings,
    });
  } catch (err) {
    console.error('[media-ingest] verification failed:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.post('/media/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'image file is required' });
    }

    const { complaintId, capturedLat, capturedLng, capturedAt } = req.body;

    if (!complaintId) {
      return res.status(400).json({ error: 'complaintId is required' });
    }

    const imageBuffer = req.file.buffer;
    const exifData = extractExifData(imageBuffer);
    const sha256 = require('crypto').createHash('sha256').update(imageBuffer).digest('hex');

    const { url, cid, provider } = await uploadToStorage(imageBuffer, sha256, req.file.mimetype);

    await pool.query(
      `INSERT INTO complaint_attachments (complaint_id, kind, file_path, file_mime, file_sha256, note)
       VALUES ($1, 'PHOTO', $2, $3, $4, $5)`,
      [complaintId, cid, req.file.mimetype, sha256, JSON.stringify({
        cid,
        provider,
        capturedAt: capturedAt ?? null,
        capturedLat: capturedLat ? Number(capturedLat) : null,
        capturedLng: capturedLng ? Number(capturedLng) : null,
        exif: {
          timestamp: exifData.timestamp,
          latitude: exifData.latitude,
          longitude: exifData.longitude,
        },
      })]
    );

    res.json({
      ok: true,
      attachment: {
        cid,
        url,
        provider,
        sha256,
        exif: {
          timestamp: exifData.timestamp,
          latitude: exifData.latitude,
          longitude: exifData.longitude,
        },
      },
    });
  } catch (err) {
    console.error('[media-ingest] upload failed:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

async function uploadToStorage(buffer: Buffer, hash: string, mimeType: string): Promise<{ url: string; cid: string; provider: 'supabase-storage' | 'local-fallback' }> {
  const supabaseUrl = getEnv('SUPABASE_URL', '');
  const supabaseKey = getEnv('SUPABASE_ANON_KEY', '');
  const bucket = getEnv('SUPABASE_STORAGE_BUCKET', 'roadwatch-media');

  if (!supabaseUrl || !supabaseKey) {
    const localPath = `local://${bucket}/${hash}`;
    return { url: localPath, cid: hash, provider: 'local-fallback' };
  }

  const objectKey = `complaints/${hash}`;
  const uploadUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(objectKey)}`;

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      apikey: supabaseKey,
      'Content-Type': mimeType,
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase Storage upload failed: ${response.status} ${body}`);
  }

  const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURIComponent(objectKey)}`;
  return { url: publicUrl, cid: objectKey, provider: 'supabase-storage' };
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'media-ingest' });
});

app.listen(PORT, () => {
  console.log(`[media-ingest] listening on http://localhost:${PORT}`);
});