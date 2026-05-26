/**
 * Image and video compression pipeline for optimizing media uploads
 */
export class CompressionPipeline {

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    try { return String(err ?? 'Unknown error'); } catch { return 'Unknown error'; }
  }
  
  /**
   * Compresses image to WebP format with specified quality
   */
  async compressImageToWebP(input: string | Buffer, qualityTarget: number = 0.8): Promise<Buffer> {
    try {
      console.log(`[CompressionPipeline]: Compressing image to WebP with quality ${qualityTarget * 100}%`);
      
      let inputBuffer: Buffer;
      
      // Handle both file path and buffer input
      if (typeof input === 'string') {
        const fs = await import('fs/promises');
        inputBuffer = await fs.readFile(input);
      } else {
        inputBuffer = input;
      }
      
      // For now, use a simple compression approach
      // In production, you'd use sharp, jimp, or similar library
      if (typeof window !== 'undefined') {
        // Browser environment - use Canvas API
        return await this.compressImageInBrowser(inputBuffer, qualityTarget);
      } else {
        // Node.js environment - use sharp if available, otherwise return original
        try {
          const sharp = await import('sharp');
          return await sharp.default(inputBuffer)
            .webp({ quality: Math.round(qualityTarget * 100) })
            .toBuffer();
        } catch (error) {
          console.warn('[CompressionPipeline]: Sharp not available, returning original buffer');
          return inputBuffer;
        }
      }
    } catch (error) {
      console.error('[CompressionPipeline]: Compression failed:', error);
      throw error;
    }
  }

  /**
   * Browser-based image compression using Canvas API
   */
  private async compressImageInBrowser(buffer: Buffer, quality: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions (max 1920x1080)
        const maxWidth = 1920;
        const maxHeight = 1080;
        let { width, height } = img;
        
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width *= ratio;
          height *= ratio;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw and compress
        ctx?.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Canvas compression failed'));
            return;
          }
          
          const reader = new FileReader();
          reader.onload = () => {
            const arrayBuffer = reader.result as ArrayBuffer;
            resolve(Buffer.from(arrayBuffer));
          };
          reader.onerror = () => reject(new Error('FileReader failed'));
          reader.readAsArrayBuffer(blob);
        }, 'image/webp', quality);
      };
      
      img.onerror = () => reject(new Error('Image load failed'));
      
      // Convert buffer to data URL
      // Copy buffer into a standard Uint8Array backed by an ArrayBuffer to satisfy Blob typings
      const bufCopy = new Uint8Array(buffer.length);
      bufCopy.set(buffer as any);
      const blob = new Blob([bufCopy]);
      const url = URL.createObjectURL(blob);
      img.src = url;
    });
  }

  /**
   * Compresses video to H.265/HEVC format using FFmpeg
   */
  async transcodeVideoToHEVC(localFilePath: string, options?: {
    quality?: 'low' | 'medium' | 'high';
    maxWidth?: number;
    maxHeight?: number;
    maxBitrate?: string;
  }): Promise<string> {
    try {
      console.log(`[CompressionPipeline]: Starting video transcoding for ${localFilePath}`);
      
      const opts = {
        quality: options?.quality || 'medium',
        maxWidth: options?.maxWidth || 1920,
        maxHeight: options?.maxHeight || 1080,
        maxBitrate: options?.maxBitrate || '2M'
      };
      
      // Check if we're in browser environment
      if (typeof window !== 'undefined') {
        return await this.transcodeVideoInBrowser(localFilePath, opts);
      } else {
        return await this.transcodeVideoInNode(localFilePath, opts);
      }
      
    } catch (error) {
      console.error('[CompressionPipeline]: Video transcoding failed:', this.getErrorMessage(error));
      throw new Error(`Video transcoding failed: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Browser-based video transcoding using FFmpeg.wasm
   */
  private async transcodeVideoInBrowser(inputPath: string, options: any): Promise<string> {
    try {
      // Dynamic import of FFmpeg.wasm for browser environment
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { fetchFile } = await import('@ffmpeg/util');
      
      const ffmpeg = new FFmpeg();
      
      // Load FFmpeg
      await ffmpeg.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm'
      });
      
      // Load input file
      const inputData = await fetchFile(inputPath);
      await ffmpeg.writeFile('input.mp4', inputData);
      
      // Build FFmpeg command based on quality settings
      const qualitySettings = this.getQualitySettings(options.quality);
      const outputPath = inputPath.replace(/\.[^/.]+$/, '_compressed.mp4');
      
      const ffmpegArgs = [
        '-i', 'input.mp4',
        '-c:v', 'libx265',
        '-preset', qualitySettings.preset,
        '-crf', qualitySettings.crf.toString(),
        '-maxrate', options.maxBitrate,
        '-bufsize', '4M',
        '-vf', `scale='min(${options.maxWidth},iw)':'min(${options.maxHeight},ih)':force_original_aspect_ratio=decrease`,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        'output.mp4'
      ];
      
      console.log('[CompressionPipeline]: Running FFmpeg with args:', ffmpegArgs.join(' '));
      
      // Execute transcoding
      await ffmpeg.exec(ffmpegArgs);
      
      // Read output file
      const outputData = await ffmpeg.readFile('output.mp4');
      
      // Save to local file system (if supported)
      if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: outputPath.split('/').pop(),
          types: [{
            description: 'MP4 videos',
            accept: { 'video/mp4': ['.mp4'] }
          }]
        });
        
        const writable = await fileHandle.createWritable();
        await writable.write(outputData);
        await writable.close();
        
        return outputPath;
      } else {
        // Fallback: create blob URL
        const outCopy = new Uint8Array(outputData.length);
        outCopy.set(outputData as any);
        const blob = new Blob([outCopy], { type: 'video/mp4' });
        return URL.createObjectURL(blob);
      }
      
    } catch (error) {
      console.error('[CompressionPipeline]: Browser video transcoding failed:', this.getErrorMessage(error));
      throw new Error(this.getErrorMessage(error));
    }
  }

  /**
   * Node.js-based video transcoding using FFmpeg binary
   */
  private async transcodeVideoInNode(inputPath: string, options: any): Promise<string> {
    try {
      const path = await import('path');
      const { spawn } = await import('child_process');
      const fs = await import('fs/promises');
      
      // Check if FFmpeg is available
      const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
      
      // Generate output path
      const parsedPath = path.parse(inputPath);
      const outputPath = path.join(
        parsedPath.dir,
        `${parsedPath.name}_compressed${parsedPath.ext}`
      );
      
      // Build FFmpeg command
      const qualitySettings = this.getQualitySettings(options.quality);
      
      const ffmpegArgs = [
        '-i', inputPath,
        '-c:v', 'libx265',
        '-preset', qualitySettings.preset,
        '-crf', qualitySettings.crf.toString(),
        '-maxrate', options.maxBitrate,
        '-bufsize', '4M',
        '-vf', `scale='min(${options.maxWidth},iw)':'min(${options.maxHeight},ih)':force_original_aspect_ratio=decrease`,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y', // Overwrite output file
        outputPath
      ];
      
      console.log('[CompressionPipeline]: Running FFmpeg:', ffmpegPath, ffmpegArgs.join(' '));
      
      // Execute FFmpeg
      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn(ffmpegPath, ffmpegArgs);
        
        let stderr = '';
        
        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
          // Log progress if available
          const progressMatch = stderr.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
          if (progressMatch) {
            console.log(`[CompressionPipeline]: Progress: ${progressMatch[1]}`);
          }
        });
        
        ffmpeg.on('close', (code) => {
          if (code === 0) {
            console.log('[CompressionPipeline]: Video transcoding completed successfully');
            resolve();
          } else {
            console.error('[CompressionPipeline]: FFmpeg stderr:', stderr);
            reject(new Error(`FFmpeg exited with code ${code}`));
          }
        });
        
        ffmpeg.on('error', (error) => {
          reject(new Error(`FFmpeg spawn error: ${this.getErrorMessage(error)}`));
        });
      });
      
      // Verify output file exists
      try {
        await fs.access(outputPath);
        const stats = await fs.stat(outputPath);
        console.log(`[CompressionPipeline]: Output file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      } catch (error) {
        throw new Error(`Output file not created: ${outputPath}`);
      }
      
      return outputPath;
      
    } catch (error) {
      console.error('[CompressionPipeline]: Node.js video transcoding failed:', this.getErrorMessage(error));
      throw new Error(this.getErrorMessage(error));
    }
  }

  /**
   * Get quality settings based on quality level
   */
  private getQualitySettings(quality: 'low' | 'medium' | 'high'): {
    preset: string;
    crf: number;
  } {
    switch (quality) {
      case 'low':
        return { preset: 'fast', crf: 28 };
      case 'medium':
        return { preset: 'medium', crf: 23 };
      case 'high':
        return { preset: 'slow', crf: 18 };
      default:
        return { preset: 'medium', crf: 23 };
    }
  }

  /**
   * Get video metadata using FFprobe
   */
  async getVideoMetadata(filePath: string): Promise<{
    duration: number;
    width: number;
    height: number;
    bitrate: number;
    codec: string;
    size: number;
  }> {
    try {
      if (typeof window !== 'undefined') {
        // Browser environment - limited metadata extraction
        return await this.getVideoMetadataInBrowser(filePath);
      } else {
        // Node.js environment - use FFprobe
        return await this.getVideoMetadataInNode(filePath);
      }
    } catch (error) {
      console.error('[CompressionPipeline]: Failed to get video metadata:', error);
      throw error;
    }
  }

  private async getVideoMetadataInBrowser(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      
      video.onloadedmetadata = () => {
        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          bitrate: 0, // Not available in browser
          codec: 'unknown',
          size: 0 // Not available in browser
        });
      };
      
      video.onerror = () => reject(new Error('Failed to load video metadata'));
      video.src = filePath;
    });
  }

  private async getVideoMetadataInNode(filePath: string): Promise<any> {
    const { spawn } = await import('child_process');
    const fs = await import('fs/promises');
    
    // Get file size
    const stats = await fs.stat(filePath);
    
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ]);
      
      let stdout = '';
      let stderr = '';
      
      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ffprobe.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffprobe.on('close', (code) => {
        if (code === 0) {
            try {
            const metadata = JSON.parse(stdout);
            const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video');
            
            if (!videoStream) {
              reject(new Error('No video stream found'));
              return;
            }
            
            resolve({
              duration: parseFloat(metadata.format.duration) || 0,
              width: videoStream.width || 0,
              height: videoStream.height || 0,
              bitrate: parseInt(metadata.format.bit_rate) || 0,
              codec: videoStream.codec_name || 'unknown',
              size: stats.size
            });
          } catch (error) {
            reject(new Error(`Failed to parse FFprobe output: ${this.getErrorMessage(error)}`));
          }
        } else {
          reject(new Error(`FFprobe exited with code ${code}: ${stderr}`));
        }
      });
      
      ffprobe.on('error', (error) => {
        reject(new Error(`FFprobe spawn error: ${error.message}`));
      });
    });
  }
}
