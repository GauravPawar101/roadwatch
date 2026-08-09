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
export declare const FIELD_VISIBILITY: Record<UserRole, Record<string, FieldVisibility>>;
/**
 * Filter image submission fields based on user role
 */
export declare function filterImageSubmissionByRole(submission: ImageSubmission, context: PrivacyContext): Partial<ImageSubmission>;
/**
 * Filter metadata to remove identifying information
 */
export declare function filterMetadata(metadata: any, context: PrivacyContext): any;
/**
 * Check if user can read a specific submission
 */
export declare function canReadSubmission(submission: ImageSubmission, context: PrivacyContext): {
    allowed: boolean;
    reason?: string;
};
/**
 * Check if user can decrypt user IDs
 */
export declare function canDecryptUserIds(context: PrivacyContext): boolean;
/**
 * Log access for audit trail
 */
export declare function createAccessLog(context: PrivacyContext, resource_type: string, resource_id: string, action: 'read' | 'create' | 'update' | 'delete' | 'export', accessed_fields: string[], status?: 'Success' | 'Denied' | 'Error', reason_blocked?: string): Partial<AccessLog>;
/**
 * Validate field-level access before reading
 */
export declare function validateFieldAccess(field: string, context: PrivacyContext, ownerUserId: string): {
    allowed: boolean;
    reason?: string;
};
/**
 * Mask sensitive user identification fields in API responses
 */
export declare function maskUserIdentifiers(data: any, context: PrivacyContext): any;
/**
 * Generate restricted query filter based on role
 */
export declare function getQueryFilterByRole(context: PrivacyContext): any;
/**
 * Check if user can export data (stricter audit requirement)
 */
export declare function canExportData(context: PrivacyContext): {
    allowed: boolean;
    reason?: string;
};
//# sourceMappingURL=privacy-service.d.ts.map