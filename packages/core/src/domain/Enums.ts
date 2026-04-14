export enum RoadType {
  NH = 'NH',        // National Highway
  SH = 'SH',        // State Highway
  MDR = 'MDR',      // Major District Road
  Urban = 'Urban',  // Urban Road
  Rural = 'Rural'   // Rural Road
}

export enum ComplaintStatus {
  Reported = 'Reported',
  UnderReview = 'UnderReview',
  Assigned = 'Assigned',
  InProgress = 'InProgress',
  Resolved = 'Resolved',
  Rejected = 'Rejected'
}

export enum DamageType {
  Pothole = 'Pothole',
  Waterlogging = 'Waterlogging',
  Cracks = 'Cracks',
  BrokenDivider = 'BrokenDivider',
  MissingSignage = 'MissingSignage'
}

export enum Severity {
  Low = 1,
  Minor = 2,
  Moderate = 3,
  Severe = 4,
  Critical = 5
}

export enum UserRole {
  CITIZEN = 'CITIZEN',
  FIELD_INSPECTOR = 'FIELD_INSPECTOR',
  EXECUTIVE_ENGINEER = 'EXECUTIVE_ENGINEER',
  SUPERINTENDENT_ENG = 'SUPERINTENDENT_ENG',
  CHIEF_ENGINEER = 'CHIEF_ENGINEER',
  CONTRACTOR_REP = 'CONTRACTOR_REP',
  ADMIN = 'ADMIN'
}
