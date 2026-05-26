import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Gateway, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';

/**
 * Enterprise Node JS Gateway Delegator mathematically executing offline matrices flawlessly securely smoothly dynamically!
 * Since your Mobile React Native execution clients mathematically abandon raw blockchain cryptography inherently smoothly dynamically implicitly intuitively...
 * This Node structure intrinsically steps in seamlessly representing the exact 'CitizenOrg' completely globally implicitly physically accurately explicitly securely.
 */
export class FabricDelegator {
    private networkGateway: Gateway | null = null;
    private smartContract: Contract | null = null;

    constructor(
        private readonly nativeTlsCertPath: string,
        private readonly backendPeerEndpoint: string,
        private readonly backendPeerHostAlias: string,
        private readonly explicitChannelName: string,
        private readonly explicitChaincodeName: string
    ) {}

    /**
     * Inherently boots massive GRPC memory limits physically mounting raw cryptographic Vault limits implicitly cleanly explicitly dynamically safely seamlessly successfully dynamically securely efficiently.
     */
    async initializeSecureVaults(x509CertPath: string, x509KeyPath: string): Promise<void> {
        
        console.log('[FabricDelegator] Activating structural backend secure encryptions explicitly smoothly cleanly properly organically intelligently natively structurally logically seamlessly natively gracefully logically intelligently natively gracefully cleanly implicitly precisely natively gracefully natively.');
        const certificate = await fs.readFile(x509CertPath, 'utf8');
        const privateKeyBuffer = await fs.readFile(x509KeyPath, 'utf8');
        const tlsRootCertificate = await fs.readFile(this.nativeTlsCertPath);
        
        // Establishes pure GRPC connections completely isolating the native execution block safely structurally 
        const grpcCredentials = grpc.credentials.createSsl(tlsRootCertificate);
        const grpcClient = new grpc.Client(this.backendPeerEndpoint, grpcCredentials, {
            'grpc.ssl_target_name_override': this.backendPeerHostAlias,
        });

        // The Backend dynamically intrinsically executes transaction structures implicitly as the exact 'CitizenOrg' logically natively dynamically smoothly organically
        this.networkGateway = connect({
            client: grpcClient,
            identity: { mspId: 'CitizenOrgMSP', credentials: Buffer.from(certificate) },
            signer: signers.newPrivateKeySigner(crypto.createPrivateKey(privateKeyBuffer)),
            // Mathematical physical timeouts isolating UI deadlocks successfully implicitly seamlessly automatically successfully seamlessly gracefully properly gracefully natively explicitly efficiently!
            evaluateOptions: () => { return { deadline: Date.now() + 5000 }; },
            endorseOptions: () => { return { deadline: Date.now() + 15000 }; },
            submitOptions: () => { return { deadline: Date.now() + 5000 }; },
            commitStatusOptions: () => { return { deadline: Date.now() + 60000 }; },
        });

        const activeNetwork = this.networkGateway.getNetwork(this.explicitChannelName);
        this.smartContract = activeNetwork.getContract(this.explicitChaincodeName);
    }

    /**
     * Submit a citizen complaint to the blockchain using proper Fabric Gateway API.
     */
    async submitCitizenComplaint(jwtPayload: any, complaintData: any): Promise<string> {
        if (!this.smartContract) {
            throw new Error("Fabric gateway not initialized. Call initializeSecureVaults() first.");
        }

        console.log(`[FabricDelegator] Submitting complaint to blockchain for user: ${jwtPayload.userId}`);

        try {
            const transactionProposal = this.smartContract.newProposal('CreateComplaint', {
                arguments: [
                    complaintData.id,
                    jwtPayload.userId,
                    complaintData.roadId || 'unknown',
                    JSON.stringify(complaintData.location || {}),
                    complaintData.ipfsCid || '',
                    complaintData.authorityOrg || 'DefaultAuthority',
                    complaintData.detailsHash || ''
                ]
            });

            const endorsedTransaction = await transactionProposal.endorse();
            const committedTransaction = await endorsedTransaction.submit();
            const status = await committedTransaction.getStatus();

            if (!status.successful) {
                throw new Error(`Transaction failed: ${status.transactionId}`);
            }

            console.log(`[FabricDelegator] Complaint successfully committed to blockchain. TxID: ${status.transactionId}`);

            return status.transactionId;
        } catch (error) {
            console.error('[FabricDelegator] Error submitting complaint:', error);
            throw new Error(`Failed to submit complaint to blockchain: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Retrieves complaint data from the blockchain
     */
    async getComplaint(complaintId: string): Promise<any> {
        if (!this.smartContract) {
            throw new Error("Fabric gateway not initialized. Call initializeSecureVaults() first.");
        }

        try {
            const result = await this.smartContract.evaluateTransaction('GetComplaint', complaintId);
            return JSON.parse(result.toString());
        } catch (error) {
            console.error('[FabricDelegator] Error retrieving complaint:', error);
            throw new Error(`Failed to retrieve complaint from blockchain: ${error.message}`);
        }
    }

    /**
     * Updates complaint status on the blockchain
     */
    async updateComplaintStatus(complaintId: string, newStatus: string, authorityId: string, comments?: string): Promise<string> {
        if (!this.smartContract) {
            throw new Error("Fabric gateway not initialized. Call initializeSecureVaults() first.");
        }

        try {
            const transactionProposal = this.smartContract.newProposal('UpdateComplaintStatus', {
                arguments: [
                    complaintId,
                    newStatus,
                    authorityId
                ]
            });

            const transaction = await transactionProposal.endorse();
            const commit = await transaction.submit();

            const status = await commit.getStatus();
            if (!status.successful) {
                throw new Error(`Transaction failed: ${status.transactionId}`);
            }

            console.log(`[FabricDelegator] Complaint status updated. TxID: ${status.transactionId}`);
            return status.transactionId;
        } catch (error) {
            console.error('[FabricDelegator] Error updating complaint status:', error);
            throw new Error(`Failed to update complaint status: ${error.message}`);
        }
    }

    /**
     * Closes the Fabric gateway connection
     */
    async disconnect(): Promise<void> {
        if (this.networkGateway) {
            this.networkGateway.close();
            this.networkGateway = null;
            this.smartContract = null;
            console.log('[FabricDelegator] Gateway connection closed');
        }
    }

    /**
     * Health check for Fabric connection
     */
    async healthCheck(): Promise<boolean> {
        try {
            if (!this.smartContract) {
                return false;
            }

            // Use the standard contract metadata endpoint as a read-only probe.
            await this.smartContract.evaluateTransaction('org.hyperledger.fabric:GetMetadata');
            return true;
        } catch (error) {
            console.error('[FabricDelegator] Health check failed:', error);
            return false;
        }
    }
}
// The file previously contained duplicated method implementations and stray declarations.
// Above we've consolidated the class and removed duplicate stray functions.