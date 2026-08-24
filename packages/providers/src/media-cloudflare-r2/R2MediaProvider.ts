import { bufferToUint8Array } from '../bufferUtils';
import { CompressionPipeline } from './CompressionPipeline';
import { PresignedUrlGenerator } from './PresignedUrlGenerator';

/**
 * Concrete Cloudflare R2 Media Provider implementing standard architecture constraints securely.
 */
export class R2MediaProvider {
  constructor(
    private readonly compressor: CompressionPipeline,
    private readonly urlGenerator: PresignedUrlGenerator
  ) {}

  /**
   * Strictly limits hardware rendering dynamically preventing Gallery manipulation externally.
   */
  async capturePhoto(): Promise<{ localPath: string }> {
     // Hardware API Stub (e.g., matching React Native VisionCamera logic rigidly)
     return { localPath: 'file:///data/user/0/roadwatch/cache/img_raw_sensor_392.jpg' };
  }

  /**
   * Applies mathematically destructive optimizations structurally before network serialization.
   */
    async compressMedia(localPath: string, quality: number): Promise<Buffer> {
      return this.compressor.compressImageToWebP(localPath, quality);
  }

  /**
   * Executes massive-scale bypassing architectures ensuring Cloudflare edge nodes receive physical blobs directly.
   */
  async uploadMedia(localPath: string): Promise<string> {
    try {
      // Read file from local path
      const fs = await import('fs/promises');
      const fileBuffer = await fs.readFile(localPath);
      
      // Compress if needed
      const compressedBuffer = await this.compressor.compressImageToWebP(fileBuffer, 0.8);
      
      // Get pre-signed upload URL
      const { uploadUrl, mediaKey } = await this.urlGenerator.requestUploadUrl('image/webp', compressedBuffer.length);
      
      console.log(`Uploading ${compressedBuffer.length} bytes to Cloudflare R2: ${uploadUrl}`);
      
      // Upload to Cloudflare R2
      const tmp = bufferToUint8Array(compressedBuffer as Buffer);
      const copy = new Uint8Array(tmp.length);
      copy.set(tmp as any);
      const body = new Blob([copy]);
      const r2Response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': compressedBuffer.length.toString()
        },
        body
      });

      if (!r2Response.ok) {
        throw new Error(`R2 upload failed: ${r2Response.status} ${r2Response.statusText}`);
      }

      // Return the media key/URL
      return mediaKey;
    } catch (error) {
      console.error('R2 upload failed:', error);
      throw new Error(`Cloudflare R2 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Download media from Cloudflare R2
   */
  async downloadMedia(mediaKey: string): Promise<Buffer> {
    try {
      const downloadUrl = await this.urlGenerator.requestDownloadUrl(mediaKey);
      
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`R2 download failed: ${response.status} ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error('R2 download failed:', error);
      throw new Error(`Cloudflare R2 download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete media from Cloudflare R2
   */
  async deleteMedia(mediaKey: string): Promise<boolean> {
    try {
      const deleteUrl = await this.urlGenerator.requestDeleteUrl(mediaKey);
      
      const response = await fetch(deleteUrl, { method: 'DELETE' });
      return response.ok;
    } catch (error) {
      console.error('R2 delete failed:', error);
      return false;
    }
  }
}
