import { CIDValidator } from './CIDValidator';

/**
 * Decentralized Massive Volume Storage Adapter seamlessly executing physical file pinning directly dynamically.
 */
export class PinataMediaProvider {
    constructor(
       private readonly validator: CIDValidator,
       private readonly pinataJwtToken: string
    ) {}

    /**
     * Triggers fault-tolerant Multipart execution safely completely bypassing centralized backends purely.
     */
    async uploadMedia(localPath: string, retries = 3): Promise<string> {
        let attempts = 0;
        
        while (attempts < retries) {
            try {
                console.log(`[PinataMediaProvider] Attempt ${attempts + 1}: Uploading to IPFS via Pinata...`);
                
                // Read file from local path
                const fs = await import('fs/promises');
                const fileBuffer = await fs.readFile(localPath);
                
                // Generate local hash for verification (use a copied Uint8Array backed by ArrayBuffer)
                const localUint8 = new Uint8Array(fileBuffer.length);
                localUint8.set(fileBuffer);
                const localHash = await this.validator.generateLocalHash(localUint8);
                
                // Create form data for Pinata upload
                const formData = new FormData();
                // Convert Node Buffer to Uint8Array for Blob/Fetch compatibility
                // Ensure a Uint8Array backed by a standard ArrayBuffer
                const uint8 = new Uint8Array(fileBuffer.length);
                uint8.set(fileBuffer);
                const blob = new Blob([uint8], { type: 'image/jpeg' });
                formData.append('file', blob, `image_${Date.now()}.jpg`);
                
                // Optional metadata
                const metadata = JSON.stringify({
                    name: `RoadWatch Image ${Date.now()}`,
                    keyvalues: {
                        uploadedAt: new Date().toISOString(),
                        source: 'roadwatch-app'
                    }
                });
                formData.append('pinataMetadata', metadata);
                
                // Upload to Pinata
                const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.pinataJwtToken}`
                    },
                    body: formData
                });
                
                if (!response.ok) {
                    throw new Error(`Pinata upload failed: ${response.status} ${response.statusText}`);
                }
                
                const result = await response.json();
                const cid = result.IpfsHash;
                
                // Validate upload
                if (this.validator.verifyUpload(localHash, cid)) {
                    return `ipfs://${cid}`;
                } else {
                    throw new Error('CID hash verification failed');
                }
            } catch (err) {
                attempts++;
                console.error(`[PinataMediaProvider] Upload attempt ${attempts} failed:`, err);
                
                if (attempts >= retries) {
                    throw new Error(`Upload failed after ${retries} attempts: ${err}`);
                }
                
                // Exponential backoff
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempts - 1)));
            }
        }
        throw new Error('Upload exhausted all retry attempts');
    }
    /**
     * Download media from IPFS using Pinata gateway
     */
    async downloadMedia(cid: string, retries = 3): Promise<Buffer> {
        let attempts = 0;
        
        while (attempts < retries) {
            try {
                console.log(`[PinataMediaProvider] Attempt ${attempts + 1}: Downloading from IPFS...`);
                
                // Use Pinata gateway for faster access
                const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;
                
                const response = await fetch(gatewayUrl, {
                    headers: {
                        'Authorization': `Bearer ${this.pinataJwtToken}`
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
                }
                
                const arrayBuffer = await response.arrayBuffer();
                return Buffer.from(arrayBuffer);
            } catch (err) {
                attempts++;
                console.error(`[PinataMediaProvider] Download attempt ${attempts} failed:`, err);
                
                if (attempts >= retries) {
                    throw new Error(`Download failed after ${retries} attempts: ${err}`);
                }
                
                // Exponential backoff
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempts - 1)));
            }
        }
        throw new Error('Download exhausted all retry attempts');
    }

    /**
     * Check if content is pinned on Pinata
     */
    async isPinned(cid: string): Promise<boolean> {
        try {
            const response = await fetch(`https://api.pinata.cloud/data/pinList?hashContains=${cid}`, {
                headers: {
                    'Authorization': `Bearer ${this.pinataJwtToken}`
                }
            });
            
            if (!response.ok) {
                return false;
            }
            
            const result = await response.json();
            return result.count > 0;
        } catch (err) {
            console.error(`[PinataMediaProvider] Pin check failed:`, err);
            return false;
        }
    }

    /**
     * Unpin content from Pinata (cleanup)
     */
    async unpinMedia(cid: string): Promise<boolean> {
        try {
            const response = await fetch(`https://api.pinata.cloud/pinning/unpin/${cid}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.pinataJwtToken}`
                }
            });
            
            return response.ok;
        } catch (err) {
            console.error(`[PinataMediaProvider] Unpin failed:`, err);
            return false;
        }
    }

    /**
     * Get metadata for pinned content
     */
    async getMetadata(cid: string): Promise<any> {
        try {
            const response = await fetch(`https://api.pinata.cloud/data/pinList?hashContains=${cid}`, {
                headers: {
                    'Authorization': `Bearer ${this.pinataJwtToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`Metadata fetch failed: ${response.status}`);
            }
            
            const result = await response.json();
            return result.rows[0] || null;
        } catch (err) {
            console.error(`[PinataMediaProvider] Metadata fetch failed:`, err);
            return null;
        }
    }
}