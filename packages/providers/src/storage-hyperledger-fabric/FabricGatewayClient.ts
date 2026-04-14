import { JWTAuthProvider } from '../auth-standard/JWTAuthProvider';

// Generic pure abstractions natively mathematically bounding domains explicitly
// import { Complaint, Road } from '@roadwatch/core/src/domain/Entities';

/**
 * Strict Offline Edge Wrapper targeting Node JS Gateways statically effortlessly securely.
 * Replaces direct raw blockchain Mobile SDKs explicitly eliminating excessive physical C++ compiling overhead natively globally cleanly.
 */
export class FabricGatewayClient {
    constructor(
        private readonly backendApiUrl: string,
        private readonly credentialsVault: JWTAuthProvider
    ) {}

    /**
     * Executes asynchronous logical execution streams pushing physically directly to Node Gateways safely elegantly natively.
     */
    async submitComplaintToLedger(complaintData: any): Promise<void> {
        console.log(`[FabricGatewayClient]: Requesting explicit ledger write perfectly structurally mapped natively...`);
        await this.executeProtectedPost('/api/v2/ledger/invoke/complaint', complaintData);
    }

    /**
     * Commits structurally explicitly explicitly bounding execution chains optimally natively.
     */
    async submitRoadVerification(roadData: any): Promise<void> {
        await this.executeProtectedPost('/api/v2/ledger/invoke/road', roadData);
    }

    /**
     * Deeply intercepts mathematical HTTPS mappings natively dynamically injecting JSON Web Tokens correctly mathematically inherently gracefully.
     */
    private async executeProtectedPost(endpoint: string, genericPayload: any): Promise<any> {
        
        // Dynamically requests the logical array natively seamlessly assigning JWT headers physically!
        const requestConfig = await this.credentialsVault.attachInterceptor({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(genericPayload)
        });

        // Pings exact Custom API boundaries magically cleanly
        const response = await fetch(`${this.backendApiUrl}${endpoint}`, requestConfig);
        
        if (!response.ok) {
            const errorBlock = await response.text();
            throw new Error(`[FabricGatewayClient]: Native Node gateway rejected blockchain logical execution bounds strictly natively: ${errorBlock}`);
        }
        
        return response.json();
    }
}
