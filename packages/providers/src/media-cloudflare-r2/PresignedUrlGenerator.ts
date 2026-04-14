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
}
