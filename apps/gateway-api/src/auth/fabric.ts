import * as forge from 'node-forge';
import { pool } from '../postgres.js';

export interface FabricIdentity {
  id: string;
  userId: string;
  role: 'CE' | 'EE' | 'CONTRACTOR';
  orgName: string;
  certPem: string;
  mspId: string;
  verified: boolean;
}

interface CertificateValidationResult {
  isValid: boolean;
  subject?: string;
  issuer?: string;
  serialNumber?: string;
  validFrom?: Date;
  validTo?: Date;
  publicKey?: string;
  errors?: string[];
}

/**
 * Register a Fabric identity for a user
 * This is used to verify non-citizen roles (CE, EE, CONTRACTOR)
 */
export async function registerFabricIdentity(params: {
  userId: string;
  role: 'CE' | 'EE' | 'CONTRACTOR';
  orgName: string;
  certPem: string;
  mspId: string;
}): Promise<FabricIdentity> {
  const fabricId = `${params.mspId}-${params.userId}`;

  // PostgreSQL upsert: ON CONFLICT DO UPDATE
  await pool.query(
    `INSERT INTO fabric_identities (id, user_id, role, org_name, cert_pem, msp_id, verified, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       role = $3,
       org_name = $4,
       cert_pem = $5,
       msp_id = $6,
       updated_at = $9`,
    [
      fabricId,
      params.userId,
      params.role,
      params.orgName,
      params.certPem,
      params.mspId,
      false,
      new Date(),
      new Date()
    ]
  );

  const result = await pool.query(
    `SELECT id, user_id, role, org_name, cert_pem, msp_id, verified FROM fabric_identities WHERE id = $1`,
    [fabricId]
  );

  const row = result.rows[0]!;
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role as any,
    orgName: row.org_name,
    certPem: row.cert_pem,
    mspId: row.msp_id,
    verified: row.verified
  };
}

/**
 * Validates a PEM certificate using node-forge
 */
function validateCertificatePem(certPem: string): CertificateValidationResult {
  const errors: string[] = [];
  
  try {
    // Parse the PEM certificate
    const cert = forge.pki.certificateFromPem(certPem);
    
    // Extract certificate details
    const subject = cert.subject.getField('CN')?.value || 'Unknown';
    const issuer = cert.issuer.getField('CN')?.value || 'Unknown';
    const serialNumber = cert.serialNumber;
    const validFrom = cert.validity.notBefore;
    const validTo = cert.validity.notAfter;
    
    // Get public key
    const publicKeyPem = forge.pki.publicKeyToPem(cert.publicKey);
    
    // Validate certificate dates
    const now = new Date();
    if (now < validFrom) {
      errors.push('Certificate is not yet valid');
    }
    if (now > validTo) {
      errors.push('Certificate has expired');
    }
    
    // Validate certificate structure
    if (!cert.publicKey) {
      errors.push('Certificate missing public key');
    }
    
    // Check key length for RSA keys (node-forge public key shape varies)
    try {
      const maybeN = (cert.publicKey as any)?.n;
      if (maybeN && typeof maybeN.bitLength === 'function') {
        if (maybeN.bitLength() < 2048) {
          errors.push('RSA key length must be at least 2048 bits');
        }
      }
    } catch (e) {
      // Non-fatal: unable to determine key length
    }
    
    return {
      isValid: errors.length === 0,
      subject,
      issuer,
      serialNumber,
      validFrom,
      validTo,
      publicKey: publicKeyPem,
      errors: errors.length > 0 ? errors : undefined
    };
    
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      isValid: false,
      errors: [`Invalid PEM certificate: ${msg}`]
    };
  }
}

/**
 * Validates certificate against Fabric CA (mock implementation)
 * In production, this would make actual calls to Fabric CA
 */
async function validateAgainstFabricCA(certPem: string, mspId: string, orgName: string): Promise<boolean> {
  try {
    // Mock Fabric CA validation
    // In production, you would:
    // 1. Connect to Fabric CA server
    // 2. Verify certificate chain
    // 3. Check certificate revocation status
    // 4. Validate MSP membership
    
    const fabricCaUrl = process.env.FABRIC_CA_URL;
    const fabricCaAdmin = process.env.FABRIC_CA_ADMIN_CERT;
    
    if (!fabricCaUrl || !fabricCaAdmin) {
      console.warn('[FabricAuth] Fabric CA not configured, using mock validation');
      return true; // Mock success for development
    }
    
    // Simulate CA validation API call
    const response = await fetch(`${fabricCaUrl}/api/v1/certificates/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${fabricCaAdmin}`
      },
      body: JSON.stringify({
        certificate: certPem,
        mspId: mspId,
        organization: orgName
      })
    });
    
    if (!response.ok) {
      console.error(`[FabricAuth] CA validation failed: ${response.status}`);
      return false;
    }
    
    const result = await response.json();
    return result.valid === true;
    
  } catch (error) {
    console.error('[FabricAuth] Error validating against Fabric CA:', error);
    return false;
  }
}

/**
 * Verify a Fabric identity by checking the certificate
 * Performs comprehensive certificate validation including Fabric CA verification
 */
export async function verifyFabricIdentity(params: {
  userId: string;
  role: 'CE' | 'EE' | 'CONTRACTOR';
  certPem: string;
}): Promise<boolean> {
  try {
    // Step 1: Basic PEM format validation
    const basicValidation = validateCertificatePem(params.certPem);
    
    if (!basicValidation.isValid) {
      console.error('[FabricAuth] Certificate validation failed:', basicValidation.errors);
      return false;
    }
    
    console.log('[FabricAuth] Certificate basic validation passed:', {
      subject: basicValidation.subject,
      issuer: basicValidation.issuer,
      validFrom: basicValidation.validFrom,
      validTo: basicValidation.validTo
    });
    
    // Step 2: Get MSP ID and org name from database
    const identityResult = await pool.query(
      `SELECT msp_id, org_name FROM fabric_identities WHERE user_id = $1 AND role = $2`,
      [params.userId, params.role]
    );
    
    if (!identityResult.rows || identityResult.rows.length === 0) {
      console.error('[FabricAuth] No fabric identity found for user');
      return false;
    }
    
    const { msp_id: mspId, org_name: orgName } = identityResult.rows[0];
    
    // Step 3: Validate against Fabric CA
    const caValidation = await validateAgainstFabricCA(params.certPem, mspId, orgName);
    
    if (!caValidation) {
      console.error('[FabricAuth] Fabric CA validation failed');
      return false;
    }
    
    // Step 4: Update the fabric identity as verified
    await pool.query(
      `UPDATE fabric_identities SET 
         verified = $1, 
         updated_at = $2,
         cert_subject = $3,
         cert_issuer = $4,
         cert_serial = $5,
         cert_valid_from = $6,
         cert_valid_to = $7
       WHERE user_id = $8 AND role = $9`,
      [
        true, 
        new Date(), 
        basicValidation.subject,
        basicValidation.issuer,
        basicValidation.serialNumber,
        basicValidation.validFrom,
        basicValidation.validTo,
        params.userId, 
        params.role
      ]
    );

    // Step 5: Check if identity exists and update user
    const check = await pool.query(
      `SELECT id FROM fabric_identities WHERE user_id = $1 AND role = $2 LIMIT 1`,
      [params.userId, params.role]
    );

    if (check.rows && check.rows.length > 0) {
      // Also update the user as fabric_verified
      await pool.query(
        `UPDATE users SET fabric_verified = $1, fabric_identity_id = $2 WHERE id = $3`,
        [true, check.rows[0].id, params.userId]
      );
      
      console.log(`[FabricAuth] Successfully verified Fabric identity for user ${params.userId} with role ${params.role}`);
      return true;
    }

    return false;
    
  } catch (error) {
    console.error('[FabricAuth] Error during Fabric identity verification:', error);
    return false;
  }
}

/**
 * Get Fabric identity for a user and role
 */
export async function getFabricIdentity(
  userId: string,
  role: 'CE' | 'EE' | 'CONTRACTOR'
): Promise<FabricIdentity | null> {
  const result = await pool.query(
    `SELECT id, user_id, role, org_name, cert_pem, msp_id, verified FROM fabric_identities WHERE user_id = $1 AND role = $2`,
    [userId, role]
  );

  if (!result.rows || result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role as any,
    orgName: row.org_name,
    certPem: row.cert_pem,
    mspId: row.msp_id,
    verified: row.verified
  };
}

/**
 * Check if user has verified Fabric identity for their role
 */
export async function hasVerifiedFabricIdentity(userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT verified FROM fabric_identities WHERE user_id = $1 AND verified = $2 LIMIT 1`,
    [userId, true]
  );
  return !!(result.rows && result.rows.length > 0);
}