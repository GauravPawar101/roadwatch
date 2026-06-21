/**
 * Canonical complaint status values as stored in the database.
 * These are the source of truth — all services must use these exact strings.
 *
 * Note: @roadwatch/adapters defines its own ComplaintStatus enum (integer-keyed)
 * for the adapter strategy pattern (SLA, escalation path logic). The DB-facing
 * strings live here.
 */
export const DB_COMPLAINT_STATUS = {
  FILED:               'FILED',
  IN_PROGRESS:         'IN_PROGRESS',
  ESCALATED:           'ESCALATED',
  RESOLVED:            'RESOLVED',
  DISMISSED:           'DISMISSED',
  REJECTED:            'REJECTED',
  RESOLUTION_SUBMITTED:'RESOLUTION_SUBMITTED',
  CITIZEN_CONFIRMED:   'CITIZEN_CONFIRMED',
  CITIZEN_DISPUTED:    'CITIZEN_DISPUTED',
  SLA_BREACHED:        'SLA_BREACHED',
} as const;

export type DbComplaintStatus = typeof DB_COMPLAINT_STATUS[keyof typeof DB_COMPLAINT_STATUS];

/**
 * Maps a raw DB status string to the normalised API-facing display value.
 * Used by all services when returning complaint data to clients.
 */
export function normalizeComplaintStatus(raw: string | null | undefined): string {
  switch (String(raw ?? '').toUpperCase()) {
    case 'FILED':
    case 'OPEN':
      return 'Open';
    case 'IN_PROGRESS':
    case 'INPROGRESS':
      return 'InProgress';
    case 'RESOLVED':
      return 'Resolved';
    case 'DISMISSED':
      return 'Dismissed';
    case 'ESCALATED':
      return 'Escalated';
    case 'RESOLUTION_SUBMITTED':
      return 'ResolutionSubmitted';
    case 'CITIZEN_CONFIRMED':
      return 'CitizenConfirmed';
    case 'CITIZEN_DISPUTED':
      return 'CitizenDisputed';
    case 'SLA_BREACHED':
      return 'SlaBreached';
    case 'REJECTED':
      return 'Rejected';
    default:
      return String(raw ?? '');
  }
}

/**
 * Domain-level complaint status enum used by the pure-domain engines
 * (ComplaintEngine, RoadEngine, SearchEngine). These values are intentionally
 * separate from DB_COMPLAINT_STATUS — the engines work with abstract states,
 * not raw DB strings.
 */
export enum ComplaintStatus {
  Reported    = 'Reported',
  UnderReview = 'UnderReview',
  Assigned    = 'Assigned',
  InProgress  = 'InProgress',
  Resolved    = 'Resolved',
  Rejected    = 'Rejected',
}

export enum RoadType {
  NH    = 'NH',
  SH    = 'SH',
  MDR   = 'MDR',
  Urban = 'Urban',
  Rural = 'Rural',
}

export enum DamageType {
  Pothole        = 'Pothole',
  Waterlogging   = 'Waterlogging',
  Cracks         = 'Cracks',
  BrokenDivider  = 'BrokenDivider',
  MissingSignage = 'MissingSignage',
}

export enum Severity {
  Low      = 1,
  Minor    = 2,
  Moderate = 3,
  Severe   = 4,
  Critical = 5,
}

export enum UserRole {
  CITIZEN            = 'CITIZEN',
  FIELD_INSPECTOR    = 'FIELD_INSPECTOR',
  EXECUTIVE_ENGINEER = 'EXECUTIVE_ENGINEER',
  SUPERINTENDENT_ENG = 'SUPERINTENDENT_ENG',
  CHIEF_ENGINEER     = 'CHIEF_ENGINEER',
  CONTRACTOR_REP     = 'CONTRACTOR_REP',
  ADMIN              = 'ADMIN',
}
