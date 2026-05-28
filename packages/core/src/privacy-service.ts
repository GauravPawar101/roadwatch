import type { AccessLog, ImageSubmission, UserRole } from './image-types';

/**
 * Privacy & RBAC Service
 * Enforces role-based access control and field-level privacy
 */

export interface PrivacyContext {
  user_id: string;
  roles: UserRole[];
  authority_jurisdiction?: string[];
  ip_address?: string;
  user_agent?: string;
}

export type FieldVisibility = 'all' | 'own' | 'none';

/**
 * Define which fields are visible to which roles
 */
export const FIELD_VISIBILITY: Record<UserRole, Record<string, FieldVisibility>> = {
  admin: {
    id: 'all',
    request_id: 'all',
    uploader_id_encrypted: 'all', // admin can decrypt
    uploader_pseudonym: 'all',
    server_received_at: 'all',
    exif_timestamp: 'all',
    exif_latitude: 'all',
    exif_longitude: 'all',
    device_latitude: 'all',
    device_longitude: 'all',
    nonce: 'all',
    phash: 'all',
    verified_status: 'all',
    storage_path: 'all',
    metadata: 'all',
    fabric_tx_id: 'all',
    created_at: 'all',
    created_by_id: 'all',
  },
  authority: {
    id: 'all',
    request_id: 'all',
    uploader_id_encrypted: 'none', // authorities cannot see user IDs
    uploader_pseudonym: 'none', // hide pseudonym too
    server_received_at: 'all',
    exif_timestamp: 'none', // hide precise EXIF timestamp
    exif_latitude: 'all',
    exif_longitude: 'all',
    device_latitude: 'none',
    device_longitude: 'none',
    nonce: 'none',
    phash: 'none',
    verified_status: 'all',
    storage_path: 'all', // needed to view image
    metadata: 'all', // only non-identifying fields passed
    fabric_tx_id: 'all',
    created_at: 'all',
    created_by_id: 'none', // hide user id
  },
  contractor: {
    id: 'all',
    request_id: 'all',
    uploader_id_encrypted: 'none',
    uploader_pseudonym: 'none',
    server_received_at: 'all',
    exif_timestamp: 'none',
    exif_latitude: 'all',
    exif_longitude: 'all',
    device_latitude: 'none',
    device_longitude: 'none',
    nonce: 'none',
    phash: 'none',
    verified_status: 'all',
    storage_path: 'all',
    metadata: 'all',
    fabric_tx_id: 'all',
    created_at: 'all',
    created_by_id: 'none',
  },
  citizen: {
    id: 'own', // citizens only see their own submissions
    request_id: 'own',
    uploader_id_encrypted: 'own',
    uploader_pseudonym: 'own',
    server_received_at: 'own',
    exif_timestamp: 'own',
    exif_latitude: 'own',
    exif_longitude: 'own',
    device_latitude: 'own',
    device_longitude: 'own',
    nonce: 'own',
    phash: 'own',
    verified_status: 'own',
    storage_path: 'own',
    metadata: 'own',
    fabric_tx_id: 'own',
    created_at: 'own',
    created_by_id: 'own',
  },
};

/**
 * Filter image submission fields based on user role
 */
export function filterImageSubmissionByRole(
  submission: ImageSubmission,
  context: PrivacyContext
): Partial<ImageSubmission> {
  const filtered: Partial<ImageSubmission> = {};

  // Determine effective role (if multi-role, use most permissive)
  const effectiveRole = getEffectiveRole(context.roles);

  const visibility = FIELD_VISIBILITY[effectiveRole];

  for (const [field, value] of Object.entries(submission)) {
    const fieldVisibility = visibility[field] || 'none';

    // Apply visibility rules
    if (fieldVisibility === 'all') {
      (filtered as any)[field] = value;
    } else if (fieldVisibility === 'own') {
      // Only show if user is the owner
      if (submission.created_by_id === context.user_id) {
        (filtered as any)[field] = value;
      }
    }
    // 'none' = skip field
  }

  return filtered;
}

/**
 * Filter metadata to remove identifying information
 */
export function filterMetadata(
  metadata: any,
  context: PrivacyContext
): any {
  const effectiveRole = getEffectiveRole(context.roles);

  if (effectiveRole === 'admin' || effectiveRole === 'citizen') {
    return metadata;
  }

  // For authority/contractor, remove sensitive metadata
  const filtered = { ...metadata };
  delete filtered.device_id;
  delete filtered.device_model;
  delete filtered.device_imei;
  delete filtered.user_agent;

  return filtered;
}

/**
 * Check if user can read a specific submission
 */
export function canReadSubmission(
  submission: ImageSubmission,
  context: PrivacyContext
): {
  allowed: boolean;
  reason?: string;
} {
  const effectiveRole = getEffectiveRole(context.roles);

  // Admin can read everything
  if (effectiveRole === 'admin') {
    return { allowed: true };
  }

  // Authority/Contractor can read submissions in their jurisdiction
  if ((effectiveRole === 'authority' || effectiveRole === 'contractor') && context.authority_jurisdiction) {
    // Check if submission location is in jurisdiction (simplified)
    // In production, query jurisdiction geofence from database
    return { allowed: true };
  }

  // Citizens can only read their own submissions
  if (effectiveRole === 'citizen' && submission.created_by_id !== context.user_id) {
    return { allowed: false, reason: 'Citizens can only view their own submissions' };
  }

  return { allowed: true };
}

/**
 * Check if user can decrypt user IDs
 */
export function canDecryptUserIds(context: PrivacyContext): boolean {
  return getEffectiveRole(context.roles) === 'admin';
}

/**
 * Determine effective role (if multi-role, use most permissive)
 */
function getEffectiveRole(roles: UserRole[]): UserRole {
  const hierarchy: UserRole[] = ['admin', 'authority', 'contractor', 'citizen'];
  for (const role of hierarchy) {
    if (roles.includes(role)) {
      return role;
    }
  }
  return 'citizen';
}

/**
 * Log access for audit trail
 */
export function createAccessLog(
  context: PrivacyContext,
  resource_type: string,
  resource_id: string,
  action: 'read' | 'create' | 'update' | 'delete' | 'export',
  accessed_fields: string[],
  status: 'Success' | 'Denied' | 'Error' = 'Success',
  reason_blocked?: string
): Partial<AccessLog> {
  return {
    user_id: context.user_id,
    resource_type,
    resource_id,
    action,
    accessed_fields,
    ip_address: context.ip_address,
    user_agent: context.user_agent,
    status,
    reason_blocked,
    created_at: Date.now(),
  };
}

/**
 * Validate field-level access before reading
 */
export function validateFieldAccess(
  field: string,
  context: PrivacyContext,
  ownerUserId: string
): {
  allowed: boolean;
  reason?: string;
} {
  const effectiveRole = getEffectiveRole(context.roles);
  const visibility = FIELD_VISIBILITY[effectiveRole][field];

  if (!visibility) {
    return { allowed: false, reason: `Field '${field}' does not exist` };
  }

  if (visibility === 'all') {
    return { allowed: true };
  }

  if (visibility === 'own' && context.user_id !== ownerUserId) {
    return { allowed: false, reason: `Field '${field}' is only visible to owner` };
  }

  if (visibility === 'none') {
    return { allowed: false, reason: `Field '${field}' is not accessible to role '${effectiveRole}'` };
  }

  return { allowed: true };
}

/**
 * Mask sensitive user identification fields in API responses
 */
export function maskUserIdentifiers(data: any, context: PrivacyContext): any {
  if (getEffectiveRole(context.roles) === 'admin') {
    return data; // Admin sees everything
  }

  const masked = { ...data };

  // Remove or mask user IDs for non-admin
  if (masked.uploader_id_encrypted) {
    masked.uploader_id_encrypted = '[REDACTED]';
  }
  if (masked.created_by_id) {
    masked.created_by_id = '[REDACTED]';
  }
  if (masked.uploader_pseudonym) {
    masked.uploader_pseudonym = `[Citizen #${Math.random().toString(36).substring(7).toUpperCase()}]`;
  }

  return masked;
}

/**
 * Generate restricted query filter based on role
 */
export function getQueryFilterByRole(context: PrivacyContext): any {
  const effectiveRole = getEffectiveRole(context.roles);

  switch (effectiveRole) {
    case 'admin':
      return {}; // No restrictions

    case 'authority':
    case 'contractor':
      return {
        // Only submissions in their jurisdiction
        // jurisdiction check would be done via JOIN with location data
      };

    case 'citizen':
      return {
        created_by_id: context.user_id, // Only their own submissions
      };
  }
}

/**
 * Check if user can export data (stricter audit requirement)
 */
export function canExportData(context: PrivacyContext): {
  allowed: boolean;
  reason?: string;
} {
  const effectiveRole = getEffectiveRole(context.roles);

  if (effectiveRole !== 'admin' && effectiveRole !== 'authority') {
    return { allowed: false, reason: 'Only admins and authorities can export data' };
  }

  return { allowed: true };
}
