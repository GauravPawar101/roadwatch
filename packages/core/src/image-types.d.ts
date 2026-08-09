export type VerificationStatus = 'Pending' | 'Verified' | 'Flagged' | 'Rejected';
export type KarmaTier = 'Trusted' | 'Standard' | 'AtRisk' | 'Suspended' | 'Banned';
export type UserRole = 'admin' | 'authority' | 'contractor' | 'citizen';
export interface ImageSubmission {
    id: string;
    request_id: string;
    uploader_id_encrypted: Buffer;
    uploader_pseudonym: string;
    server_received_at: number;
    exif_timestamp?: number;
    exif_latitude?: number;
    exif_longitude?: number;
    device_latitude?: number;
    device_longitude?: number;
    nonce: string;
    phash?: string;
    verified_status: VerificationStatus;
    storage_path: string;
    metadata: ImageMetadata;
    fabric_tx_id?: string;
    created_at: number;
    created_by_id: string;
}
export interface ImageMetadata {
    geofence_radius?: number;
    check_results?: VerificationCheckResult[];
    image_url?: string;
    thumbnail_url?: string;
    file_size?: number;
    mime_type?: string;
}
export interface VerificationCheckResult {
    type: 'exif_time' | 'geofence' | 'phash' | 'nonce' | 'manual_review' | 'duplicate' | 'tamper_detection';
    passed: boolean;
    detail: string;
    timestamp: number;
}
export interface ServerNonce {
    id: string;
    nonce: string;
    user_id: string;
    request_id?: string;
    issued_at: number;
    expires_at: number;
    used: boolean;
    used_at?: number;
}
export interface KarmaRecord {
    id: string;
    user_id: string;
    score: number;
    tier: KarmaTier;
    penalty_count: number;
    last_penalty_at?: number;
    suspended_until: number;
    ban_reason?: string;
    daily_submission_count: number;
    last_submission_date?: string;
    created_at: number;
    updated_at: number;
}
export interface VerificationAudit {
    id: string;
    submission_id: string;
    check_type: 'exif_time' | 'geofence' | 'phash' | 'nonce' | 'manual_review' | 'duplicate' | 'tamper_detection';
    check_result: boolean;
    detail: Record<string, unknown>;
    reviewer_id?: string;
    action?: 'approved' | 'rejected' | 'appealed' | 'pending_review';
    reason?: string;
    created_at: number;
}
export interface KarmaAppeal {
    id: string;
    user_id: string;
    submission_id?: string;
    reason: string;
    status: 'Pending' | 'Approved' | 'Rejected' | 'Withdrawn';
    reviewer_id?: string;
    decision?: string;
    decided_at?: number;
    created_at: number;
}
export interface UserPrivacyProfile {
    id: string;
    user_id: string;
    is_admin: boolean;
    is_authority: boolean;
    is_contractor: boolean;
    is_citizen: boolean;
    authority_jurisdiction?: string[];
    contractor_assignment?: Record<string, unknown>;
    can_view_user_ids: boolean;
    created_at: number;
    updated_at: number;
}
export interface AccessLog {
    id: string;
    user_id: string;
    resource_type: string;
    resource_id: string;
    action: 'read' | 'create' | 'update' | 'delete' | 'export';
    accessed_fields: string[];
    ip_address?: string;
    user_agent?: string;
    status: 'Success' | 'Denied' | 'Error';
    reason_blocked?: string;
    created_at: number;
}
export interface CreateImageSubmissionRequest {
    request_id: string;
    nonce: string;
    image_data: Buffer;
    exif_timestamp?: number;
    exif_latitude?: number;
    exif_longitude?: number;
    device_latitude?: number;
    device_longitude?: number;
    geofence_latitude?: number;
    geofence_longitude?: number;
    geofence_radius_meters?: number;
}
export interface ImageSubmissionResponse {
    id: string;
    request_id: string;
    uploader_pseudonym: string;
    verified_status: VerificationStatus;
    server_received_at: number;
    check_results?: VerificationCheckResult[];
}
export interface GenerateNonceRequest {
    request_id: string;
    ttl_seconds?: number;
}
export interface GenerateNonceResponse {
    nonce: string;
    issued_at: number;
    expires_at: number;
}
export interface VerificationConfig {
    time_window_ms: number;
    geofence_radius_meters: number;
    nonce_ttl_seconds: number;
    phash_threshold: number;
    daily_submission_limit: number;
    initial_karma_score: number;
    valid_submission_bonus: number;
    flagged_penalty: number;
    duplicate_penalty: number;
    appeal_cooldown_ms: number;
}
export interface ImageSubmissionQuery {
    request_id?: string;
    verified_status?: VerificationStatus;
    uploader_pseudonym?: string;
    created_at_range?: [number, number];
    limit?: number;
    offset?: number;
}
export interface KarmaLeaderboardQuery {
    tier?: KarmaTier;
    min_score?: number;
    limit?: number;
    offset?: number;
}
//# sourceMappingURL=image-types.d.ts.map