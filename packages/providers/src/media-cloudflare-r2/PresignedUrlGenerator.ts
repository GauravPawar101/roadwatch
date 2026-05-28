import { BackendAPIClient } from '../api-backend/BackendAPIClient';

export interface PresignedUrlResponse {
  uploadUrl: string;
  mediaKey: string;
  expiresIn: number;
}

/**
 * Massive Volume Offloading Interface.
 * Prevents mobile nodes from passing 100MB 4K MP4s through the primary Postgres API network, 
 * fetching signed authorization dynamically and offloading uploads exclusively to edge storage buckets.
 */
export class PresignedUrlGenerator {
  constructor(private readonly apiClient: BackendAPIClient) {}

  /**
   * Generates a structural cryptographic URL from the Custom Backend authorizing direct Cloudflare PUT requests.
   */
  async requestUploadUrl(mimeType: string, fileSizeHint: number): Promise<PresignedUrlResponse> {
    return this.apiClient.post<PresignedUrlResponse>('/api/v1/media/authorize-r2-put', {
        mime_type: mimeType,
        size_hint_bytes: fileSizeHint,
        storage_region_routing: 'auto' // Cloudflare explicitly routes edge uploads dynamically
    });
  }

  async requestDownloadUrl(mediaKey: string): Promise<string> {
    // Fallback implementation: delegate to backend if available or construct a simple path
    try {
      const resp = await this.apiClient.get<{ url: string }>(`/api/v1/media/r2/${encodeURIComponent(mediaKey)}/download`);
      return (resp as any)?.url ?? `/r2/${mediaKey}`;
    } catch (_) {
      return `/r2/${mediaKey}`;
    }
  }

  async requestDeleteUrl(mediaKey: string): Promise<string> {
    try {
      const resp = await this.apiClient.post<{ url: string }>(`/api/v1/media/r2/${encodeURIComponent(mediaKey)}/delete`, {});
      return (resp as any)?.url ?? `/r2/${mediaKey}`;
    } catch (_) {
      return `/r2/${mediaKey}`;
    }
  }
}
