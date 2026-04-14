import { RoadType, ComplaintStatus, DamageType, Severity, UserRole } from './Enums';

export interface GeoLocation {
  readonly latitude: number;
  readonly longitude: number;
}

export class User {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly phoneDetails: string,
    public readonly role: UserRole,
    public readonly zoneId?: string,
    public readonly stateId?: string
  ) {}
}

export class Authority {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly jurisdictionId: string, // Links to State or Zone DB records
    public readonly level: string // e.g., 'State', 'Municipal', 'National'
  ) {}
}

export class Contractor {
  constructor(
    public readonly id: string,
    public readonly companyName: string,
    public readonly registrationNumber: string,
    public readonly activeContractIds: readonly string[]
  ) {}
}

export class Road {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly type: RoadType,
    public readonly authorityId: string,
    public readonly totalLengthKm: number
  ) {}
}

export class BudgetRecord {
  constructor(
    public readonly id: string,
    public readonly roadId: string,
    public readonly contractorId: string,
    public readonly allocatedAmount: number,
    public readonly allocationDate: number, // Unix timestamp for multi-platform parity
    public readonly description: string
  ) {}
}

export class MediaProof {
  constructor(
    public readonly id: string,
    public readonly capturedAt: number,
    public readonly location: GeoLocation,
    public readonly fileHash: string,
    public readonly storagePath: string,
    public readonly isVideo: boolean
  ) {}
}

export class Complaint {
  constructor(
    public readonly id: string,
    public readonly authorId: string,
    public readonly roadId: string,
    public readonly location: GeoLocation,
    public readonly damageType: DamageType,
    public readonly severity: Severity,
    public readonly timestamp: number,
    public readonly mediaIds: readonly string[],
    public readonly status: ComplaintStatus = ComplaintStatus.Reported,
    public readonly resolutionNotes?: string
  ) {}

  /**
   * Enforces immutability: Updates status and returns a fresh instance 
   * rather than mutating the original memory reference.
   */
  public updateStatus(newStatus: ComplaintStatus, notes?: string): Complaint {
    return new Complaint(
      this.id,
      this.authorId,
      this.roadId,
      this.location,
      this.damageType,
      this.severity,
      this.timestamp,
      this.mediaIds,
      newStatus,
      notes || this.resolutionNotes
    );
  }
}
