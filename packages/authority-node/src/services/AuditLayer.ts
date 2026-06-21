import * as crypto from 'crypto';
import { Request } from 'express';

interface OtpSession {
    otp: string;
    officialId: string;
    mobileNumber: string;
    createdAt: number;
    expiresAt: number;
    attempts: number;
}

/**
 * AuditLayer: Enforces strong legal non-repudiation for high-value state changes.
 * Before CustodialSigner signs a blockchain transaction, this layer requires secondary verification (OTP) from the official.
 * Bundles OTP verification timestamp, employee ID, and IP address into the final Fabric chaincode payload.
 */
export class AuditLayer {
    private otpSessions: Map<string, OtpSession> = new Map();
    private readonly OTP_EXPIRY_MINUTES = 5;
    private readonly MAX_ATTEMPTS = 3;

    /**
     * Initiates the secondary verification workflow for high-value actions.
     * @param officialId The employee ID of the official.
     * @param mobileNumber The official's registered mobile number.
     * @returns Promise that resolves when OTP is sent.
     */
    async initiateOtpVerification(officialId: string, mobileNumber: string): Promise<{ sessionId: string }> {
        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const sessionId = `${officialId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        
        const session: OtpSession = {
            otp,
            officialId,
            mobileNumber,
            createdAt: Date.now(),
            expiresAt: Date.now() + (this.OTP_EXPIRY_MINUTES * 60 * 1000),
            attempts: 0
        };

        this.otpSessions.set(sessionId, session);

        try {
            // Send OTP via SMS gateway
            await this.sendOtpSms(mobileNumber, otp, officialId);
            
            // Clean up expired sessions
            this.cleanupExpiredSessions();
            
            console.log(`[AuditLayer] OTP sent to ${mobileNumber} for official ${officialId}`);
            return { sessionId };
        } catch (error) {
            // Remove session if SMS sending fails
            this.otpSessions.delete(sessionId);
            throw new Error(`Failed to send OTP: ${error.message}`);
        }
    }

    /**
     * Verifies the OTP entered by the official.
     * @param sessionId The OTP session ID.
     * @param otp The OTP entered by the official.
     * @returns Promise with verification result and metadata for audit.
     */
    async verifyOtp(sessionId: string, otp: string, req: Request): Promise<{
        verified: boolean;
        verificationTimestamp: number;
        officialId: string;
        ipAddress: string;
    }> {
        const session = this.otpSessions.get(sessionId);
        const verificationTimestamp = Date.now();
        const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
                         req.socket.remoteAddress || 
                         'unknown';

        if (!session) {
            console.warn(`[AuditLayer] Invalid session ID: ${sessionId} from IP: ${ipAddress}`);
            return {
                verified: false,
                verificationTimestamp,
                officialId: 'unknown',
                ipAddress
            };
        }

        // Check if session has expired
        if (verificationTimestamp > session.expiresAt) {
            this.otpSessions.delete(sessionId);
            console.warn(`[AuditLayer] Expired OTP session for official: ${session.officialId}`);
            return {
                verified: false,
                verificationTimestamp,
                officialId: session.officialId,
                ipAddress
            };
        }

        // Check attempt limit
        if (session.attempts >= this.MAX_ATTEMPTS) {
            this.otpSessions.delete(sessionId);
            console.warn(`[AuditLayer] Max attempts exceeded for official: ${session.officialId}`);
            return {
                verified: false,
                verificationTimestamp,
                officialId: session.officialId,
                ipAddress
            };
        }

        // Increment attempt counter
        session.attempts++;

        // Verify OTP
        const verified = session.otp === otp.trim();
        
        if (verified) {
            // Remove session on successful verification
            this.otpSessions.delete(sessionId);
            console.log(`[AuditLayer] OTP verified successfully for official: ${session.officialId}`);
        } else {
            console.warn(`[AuditLayer] Invalid OTP attempt ${session.attempts}/${this.MAX_ATTEMPTS} for official: ${session.officialId}`);
        }

        return {
            verified,
            verificationTimestamp,
            officialId: session.officialId,
            ipAddress
        };
    }

    /**
     * Sends OTP via SMS gateway
     */
    private async sendOtpSms(mobileNumber: string, otp: string, officialId: string): Promise<void> {
        // In production, integrate with SMS gateway like Twilio, AWS SNS, or local SMS service
        const message = `Your RoadWatch verification code is: ${otp}. Valid for ${this.OTP_EXPIRY_MINUTES} minutes. Do not share this code. Official ID: ${officialId}`;
        
        // Mock SMS sending - replace with actual SMS gateway integration
        console.log(`[SMS] Sending to ${mobileNumber}: ${message}`);
        
        // Simulate SMS gateway API call
        const smsGatewayUrl = process.env.SMS_GATEWAY_URL;
        const smsApiKey = process.env.SMS_API_KEY;
        
        if (smsGatewayUrl && smsApiKey) {
            try {
                const response = await fetch(smsGatewayUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${smsApiKey}`
                    },
                    body: JSON.stringify({
                        to: mobileNumber,
                        message: message,
                        sender: 'RoadWatch'
                    })
                });

                if (!response.ok) {
                    throw new Error(`SMS gateway error: ${response.status} ${response.statusText}`);
                }

                console.log(`[AuditLayer] SMS sent successfully to ${mobileNumber}`);
            } catch (error) {
                console.error(`[AuditLayer] SMS sending failed:`, error);
                throw error;
            }
        } else {
            // Development mode - log OTP instead of sending SMS
            console.log(`[DEV MODE] OTP for ${mobileNumber}: ${otp}`);
        }
    }

    /**
     * Cleans up expired OTP sessions
     */
    private cleanupExpiredSessions(): void {
        const now = Date.now();
        for (const [sessionId, session] of this.otpSessions.entries()) {
            if (now > session.expiresAt) {
                this.otpSessions.delete(sessionId);
            }
        }
    }

    /**
     * Bundles audit metadata for chaincode payload.
     * @param verification Metadata from OTP verification.
     * @returns Object to be included in Fabric transaction payload.
     */
    bundleAuditMetadata(verification: {
        verificationTimestamp: number;
        officialId: string;
        ipAddress: string;
    }) {
        return {
            audit: {
                officialId: verification.officialId,
                verificationTimestamp: verification.verificationTimestamp,
                ipAddress: verification.ipAddress,
                auditTrail: {
                    action: 'secondary_verification_completed',
                    timestamp: verification.verificationTimestamp,
                    method: 'otp_sms',
                    compliance: 'legal_non_repudiation'
                }
            }
        };
    }

    /**
     * Gets current session count for monitoring
     */
    getActiveSessionCount(): number {
        this.cleanupExpiredSessions();
        return this.otpSessions.size;
    }

    /**
     * Revokes a specific OTP session
     */
    revokeSession(sessionId: string): boolean {
        return this.otpSessions.delete(sessionId);
    }
}
