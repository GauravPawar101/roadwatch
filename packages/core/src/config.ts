/**
 * Image Submission System Configuration
 * Default settings for verification, karma, and privacy
 */

import type { VerificationConfig } from './image-types.js';
import type { KarmaConfig } from './karma-service.js';

export const VERIFICATION_CONFIG: VerificationConfig = {
  // Timestamp validation
  time_window_ms: process.env.VERIFICATION_TIME_WINDOW_MS
    ? parseInt(process.env.VERIFICATION_TIME_WINDOW_MS)
    : 10 * 60 * 1000, // 10 minutes: max age of image

  // Geofence validation
  geofence_radius_meters: process.env.VERIFICATION_GEOFENCE_RADIUS_M
    ? parseInt(process.env.VERIFICATION_GEOFENCE_RADIUS_M)
    : 50, // 50 meters: GPS accuracy tolerance

  // Nonce validation
  nonce_ttl_seconds: process.env.VERIFICATION_NONCE_TTL_SECONDS
    ? parseInt(process.env.VERIFICATION_NONCE_TTL_SECONDS)
    : 300, // 5 minutes: nonce expiration

  // Duplicate detection
  phash_threshold: process.env.VERIFICATION_PHASH_THRESHOLD
    ? parseInt(process.env.VERIFICATION_PHASH_THRESHOLD)
    : 10, // 10: max hamming distance for duplicates

  // Rate limiting
  daily_submission_limit: process.env.VERIFICATION_DAILY_LIMIT
    ? parseInt(process.env.VERIFICATION_DAILY_LIMIT)
    : 10, // 10 submissions per day per citizen

  // Karma initialization
  initial_karma_score: process.env.KARMA_INITIAL_SCORE
    ? parseInt(process.env.KARMA_INITIAL_SCORE)
    : 100,

  valid_submission_bonus: process.env.KARMA_VALID_BONUS
    ? parseInt(process.env.KARMA_VALID_BONUS)
    : 10,

  flagged_penalty: process.env.KARMA_FLAGGED_PENALTY
    ? parseInt(process.env.KARMA_FLAGGED_PENALTY)
    : -50,

  duplicate_penalty: process.env.KARMA_DUPLICATE_PENALTY
    ? parseInt(process.env.KARMA_DUPLICATE_PENALTY)
    : -30,

  // Appeal settings
  appeal_cooldown_ms: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export const KARMA_CONFIG: KarmaConfig = {
  initial_score: VERIFICATION_CONFIG.initial_karma_score,
  valid_submission_bonus: VERIFICATION_CONFIG.valid_submission_bonus,
  flagged_penalty: VERIFICATION_CONFIG.flagged_penalty,
  duplicate_penalty: VERIFICATION_CONFIG.duplicate_penalty,
  rejected_penalty: process.env.KARMA_REJECTED_PENALTY
    ? parseInt(process.env.KARMA_REJECTED_PENALTY)
    : -75, // Most severe
  appeal_success_restore: process.env.KARMA_APPEAL_RESTORE
    ? parseInt(process.env.KARMA_APPEAL_RESTORE)
    : 30,
  daily_submission_limit: VERIFICATION_CONFIG.daily_submission_limit,
  suspension_threshold_score: process.env.KARMA_SUSPENSION_THRESHOLD
    ? parseInt(process.env.KARMA_SUSPENSION_THRESHOLD)
    : -100, // Auto-suspend if negative
  ban_threshold_penalty_count: process.env.KARMA_BAN_THRESHOLD
    ? parseInt(process.env.KARMA_BAN_THRESHOLD)
    : 3, // 3 penalties = permanent ban
};

/**
 * Privacy & RBAC Configuration
 */
export const PRIVACY_CONFIG = {
  // Admin access policies
  admin: {
    can_view_all_submissions: true,
    can_decrypt_user_ids: true,
    can_view_access_logs: true,
    can_appeal_decisions: true,
  },

  // Authority access policies
  authority: {
    can_view_submissions_in_jurisdiction: true,
    can_decrypt_user_ids: false,
    can_see_timestamps: false,
    can_see_device_location: false,
    can_view_access_logs: false,
  },

  // Contractor access policies (similar to authority)
  contractor: {
    can_view_submissions_in_assigned_area: true,
    can_decrypt_user_ids: false,
    can_see_timestamps: false,
    can_see_device_location: false,
    can_view_access_logs: false,
  },

  // Citizen access policies (most restrictive)
  citizen: {
    can_view_only_own_submissions: true,
    can_decrypt_user_ids: false,
    can_appeal_decisions: true,
  },
};

/**
 * Storage Configuration
 */
export const STORAGE_CONFIG = {
  // Blob storage paths
  submissions_base_path: process.env.STORAGE_SUBMISSIONS_PATH || '/submissions',
  thumbnails_base_path: process.env.STORAGE_THUMBNAILS_PATH || '/thumbnails',

  // File sizes
  max_image_size_mb: process.env.STORAGE_MAX_SIZE_MB
    ? parseInt(process.env.STORAGE_MAX_SIZE_MB)
    : 50,
  thumbnail_max_size_mb: 5,

  // Encryption
  encryption_enabled: process.env.STORAGE_ENCRYPTION === 'true' || true,
  encryption_key_rotation_days: 90,
};

/**
 * Audit & Compliance Configuration
 */
export const AUDIT_CONFIG = {
  // Retention policies
  access_log_retention_days: process.env.AUDIT_LOG_RETENTION
    ? parseInt(process.env.AUDIT_LOG_RETENTION)
    : 365, // 1 year
  verification_audit_retention_days: 2555, // 7 years (regulatory requirement)

  // What to audit
  audit_admin_access: true,
  audit_user_id_decryption: true,
  audit_field_access: true,
  audit_karma_changes: true,

  // Alerts
  alert_on_repeated_failures: true,
  alert_threshold: 5, // alert after 5 failures in 1 hour
  alert_email: process.env.AUDIT_ALERT_EMAIL || 'admin@roadwatch.local',
};

/**
 * Fraud Detection Configuration
 */
export const FRAUD_CONFIG = {
  // Detection thresholds
  phash_similarity_threshold: VERIFICATION_CONFIG.phash_threshold,
  timestamp_anomaly_threshold_ms: 30 * 60 * 1000, // 30 min deviation
  geofence_anomaly_threshold_m: 1000, // 1 km deviation
  daily_submission_anomaly: 20, // 2x daily limit

  // Pattern detection
  detect_duplicate_uploads: true,
  detect_mass_submissions: true,
  detect_geographic_clusters: true,
  detect_time_patterns: true,

  // Actions on detection
  auto_flag_on_duplicate: true,
  auto_flag_on_mass_submission: true,
  escalate_on_pattern: true,

  // ML-based (future)
  enable_tamper_detection: process.env.FRAUD_TAMPER_DETECTION === 'true' || false,
  enable_anomaly_detection: process.env.FRAUD_ANOMALY_DETECTION === 'true' || false,
};

/**
 * Background Job Configuration
 */
export const BACKGROUND_JOBS_CONFIG = {
  // Nonce cleanup
  cleanup_expired_nonces: true,
  cleanup_interval_minutes: 60,

  // Karma decay
  apply_karma_decay: true,
  karma_decay_interval_days: 30,
  karma_decay_rate: 0.02, // 2% per month

  // Report generation
  generate_daily_reports: true,
  report_time_utc: '02:00', // 2 AM UTC

  // Archive old logs
  archive_logs: true,
  archive_after_days: 30,
};

/**
 * Notification Configuration
 */
export const NOTIFICATION_CONFIG = {
  // When to notify
  notify_on_penalty: true,
  notify_on_suspension: true,
  notify_on_appeal_decision: true,
  notify_on_successful_submission: false,

  // Channels
  channels: {
    email: process.env.NOTIFICATIONS_EMAIL === 'true' || true,
    sms: process.env.NOTIFICATIONS_SMS === 'true' || false,
    in_app: process.env.NOTIFICATIONS_IN_APP === 'true' || true,
  },

  // Email templates
  email_from: process.env.EMAIL_FROM || 'noreply@roadwatch.local',
  email_templates_path: '/templates/emails',
};

/**
 * Feature Flags
 */
export const FEATURE_FLAGS = {
  enable_nonce_overlay: process.env.FF_NONCE_OVERLAY === 'true' || true,
  enable_geofence: process.env.FF_GEOFENCE === 'true' || true,
  enable_phash_duplicate_detection: process.env.FF_PHASH === 'true' || true,
  enable_karma_system: process.env.FF_KARMA === 'true' || true,
  enable_privacy_filtering: process.env.FF_PRIVACY === 'true' || true,
  enable_audit_logging: process.env.FF_AUDIT === 'true' || true,
  enable_admin_user_id_decryption: process.env.FF_ADMIN_DECRYPT === 'true' || true,
  enable_appeals_workflow: process.env.FF_APPEALS === 'true' || true,
};

/**
 * Export all configurations
 */
export default {
  VERIFICATION_CONFIG,
  KARMA_CONFIG,
  PRIVACY_CONFIG,
  STORAGE_CONFIG,
  AUDIT_CONFIG,
  FRAUD_CONFIG,
  BACKGROUND_JOBS_CONFIG,
  NOTIFICATION_CONFIG,
  FEATURE_FLAGS,
};
