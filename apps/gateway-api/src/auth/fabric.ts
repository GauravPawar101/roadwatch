import { execute } from '../cassandra.js';

export interface FabricIdentity {
  id: string;
  userId: string;
  role: 'CE' | 'EE' | 'CONTRACTOR';
  orgName: string;
  certPem: string;
  mspId: string;
  verified: boolean;
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

  // Cassandra upsert: INSERT behaves as upsert
  await execute('INSERT INTO fabric_identities (id, user_id, role, org_name, cert_pem, msp_id, verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    fabricId,
    params.userId,
    params.role,
    params.orgName,
    params.certPem,
    params.mspId,
    false,
    new Date(),
    new Date()
  ], { prepare: true });

  const rowRes = await execute('SELECT id, user_id, role, org_name, cert_pem, msp_id, verified FROM fabric_identities WHERE id = ? LIMIT 1', [fabricId], { prepare: true });
  const row = rowRes.rows[0]!;
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
 * Verify a Fabric identity by checking the certificate
 * In production, this would validate against the Fabric network
 */
export async function verifyFabricIdentity(params: {
  userId: string;
  role: 'CE' | 'EE' | 'CONTRACTOR';
  certPem: string;
}): Promise<boolean> {
  // TODO: Implement actual Fabric certificate validation
  // For now, we'll just mark as verified if cert_pem is valid PEM format
  
  const isPem = /^-----BEGIN CERTIFICATE-----/.test(params.certPem.trim());
  if (!isPem) {
    return false;
  }

  // Update the fabric identity as verified
  // Mark verified for the identity (by userId+role). Cassandra requires known primary key; assume primary key contains id or (user_id, role)
  await execute('UPDATE fabric_identities SET verified = ?, updated_at = ? WHERE user_id = ? AND role = ?', [true, new Date(), params.userId, params.role], { prepare: true });

  // Check if identity exists
  const check = await execute('SELECT id FROM fabric_identities WHERE user_id = ? AND role = ? LIMIT 1', [params.userId, params.role], { prepare: true });
  if (check.rows && check.rows.length > 0) {
    // Also update the user as fabric_verified
    await execute('UPDATE users SET fabric_verified = ?, fabric_identity_id = ? WHERE id = ?', [true, params.userId, params.userId], { prepare: true });
    return true;
  }

  return false;
}

/**
 * Get Fabric identity for a user and role
 */
export async function getFabricIdentity(
  userId: string,
  role: 'CE' | 'EE' | 'CONTRACTOR'
): Promise<FabricIdentity | null> {
  const result = await execute('SELECT id, user_id, role, org_name, cert_pem, msp_id, verified FROM fabric_identities WHERE user_id = ? AND role = ?', [userId, role], { prepare: true });
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
  const result = await execute('SELECT verified FROM fabric_identities WHERE user_id = ? AND verified = ? LIMIT 1', [userId, true], { prepare: true });
  return !!(result.rows && result.rows.length > 0);
}
