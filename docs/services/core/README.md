# Core Domain Service

## Overview
Shared domain models, business logic, escalation subsystem, and AI prompt templates used across all RoadWatch services. Provides consistent data structures, enums, utility functions, and a full prompt template library for all AI agent personas.

## Architecture
- **Language**: TypeScript
- **Pattern**: Domain-Driven Design (DDD)
- **Validation**: Zod schemas
- **Utilities**: Geographic calculations, permission management
- **Exports**: Domain entities, enums, validators, utilities, escalation engine, prompt templates

## Key Components

### Domain Entities
- `Complaint` - Core complaint data structure
- `User` - User account and role information
- `Authority` - Authority organization details
- `Road` - Road infrastructure information
- `Contractor` - Contractor and assignment data

### Business Logic
- `PermissionGatekeeper` - Access control logic
- `ComplaintValidator` - Complaint validation rules
- `SLACalculator` - Service level agreement calculations
- `NotificationTopicGenerator` - FCM topic generation

### Escalation Subsystem (`src/escalation/`)
- `EscalationRecord` — Escalation entity (ID, tiers, delivery status, Fabric TX ID)
- `EscalationEngine` — SLA breach detection, escalation action generation, chronic complaint detection
- `IEscalationProvider` / `INotificationProvider` / `ILocalStore` — Escalation provider interfaces

> Previously orphaned in `core/` at repo root (not in workspace). Migrated into `packages/core/src/escalation/` — now properly importable as `@roadwatch/core`.

### AI Prompt Templates (`src/prompts/`)
Complete library of typed prompt templates used by the LangGraph agent and mobile AI features.

- `types.ts` — `PromptTemplate<TInput, TOutput>` interface
- `system/` — `roadwatch-agent.ts` (preamble builder), `damage-classification`, `deduplication-check`, `escalation-message`, `severity-assessment`
- `citizen/` — `complaint-filing`, `escalation-help`, `road-info-query`, `rti-guidance`, `status-query`
- `authority/` — `budget-query`, `complaint-summary`, `jurisdiction-report`, `repair-schedule`, `sla-analysis`
- `offline/` — `faq-responses`, `intent-routing`

> Previously orphaned in `core/prompts/` at repo root (not in workspace). Migrated into `packages/core/src/prompts/` — now properly importable as `@roadwatch/core`.

### Enums & Constants
- `ComplaintStatus` - Complaint lifecycle states
- `UserRole` - System user roles
- `DamageType` - Types of road damage
- `Severity` - Complaint severity levels
- `RoadType` - Road classification types

## Domain Models

### Complaint
```typescript
interface Complaint {
  id: string;
  citizenId?: string;
  roadId: string;
  district: string;
  zone: string;
  description: string;
  damageType: DamageType;
  severity: Severity;
  location: GeoCoordinate;
  status: ComplaintStatus;
  assignedContractorId?: string;
  authorityOrg: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  fabricTxId?: string;
  attachments: MediaAttachment[];
}

enum ComplaintStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED'
}

enum DamageType {
  POTHOLE = 'POTHOLE',
  CRACK = 'CRACK',
  WATERLOGGING = 'WATERLOGGING',
  DEBRIS = 'DEBRIS',
  SIGNAGE = 'SIGNAGE',
  LIGHTING = 'LIGHTING',
  OTHER = 'OTHER'
}

enum Severity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}
```

### User
```typescript
interface User {
  id: string;
  phone: string;
  phoneHash: string;
  role: UserRole;
  districts: string[];
  zones: string[];
  govtId?: string;
  createdAt: Date;
  isActive: boolean;
}

enum UserRole {
  CITIZEN = 'CITIZEN',
  EE = 'EE',           // Executive Engineer
  CE = 'CE'            // Chief Engineer
}
```

### Authority
```typescript
interface Authority {
  id: string;
  name: string;
  type: AuthorityType;
  jurisdiction: Jurisdiction;
  contactInfo: ContactInfo;
  hierarchy: AuthorityHierarchy;
}

enum AuthorityType {
  NHAI = 'NHAI',       // National Highways Authority of India
  PWD = 'PWD',         // Public Works Department
  LOCAL = 'LOCAL'      // Local Municipal Authority
}

interface Jurisdiction {
  country: string;
  state: string;
  districts: string[];
  roadTypes: RoadType[];
}
```

### Road
```typescript
interface Road {
  id: string;
  name: string;
  type: RoadType;
  districtId: string;
  authorityId: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  totalLengthKm: number;
  maintenanceContractorId?: string;
  lastInspectionDate?: Date;
}

enum RoadType {
  NATIONAL_HIGHWAY = 'NATIONAL_HIGHWAY',
  STATE_HIGHWAY = 'STATE_HIGHWAY',
  DISTRICT_ROAD = 'DISTRICT_ROAD',
  VILLAGE_ROAD = 'VILLAGE_ROAD',
  CITY_ROAD = 'CITY_ROAD'
}
```

## Business Logic Components

### Permission Gatekeeper
```typescript
class PermissionGatekeeper {
  /**
   * Check if user can access complaint based on jurisdiction
   */
  static canAccessComplaint(user: User, complaint: Complaint): boolean {
    // Citizens can only access their own complaints
    if (user.role === UserRole.CITIZEN) {
      return complaint.citizenId === user.id;
    }
    
    // Engineers can access complaints in their jurisdiction
    if (user.role === UserRole.EE || user.role === UserRole.CE) {
      return user.districts.includes(complaint.district) &&
             user.zones.includes(complaint.zone);
    }
    
    return false;
  }
  
  /**
   * Check if user can update complaint status
   */
  static canUpdateComplaintStatus(user: User, complaint: Complaint): boolean {
    if (user.role === UserRole.CITIZEN) {
      return false; // Citizens cannot update status
    }
    
    return this.canAccessComplaint(user, complaint);
  }
  
  /**
   * Check if user can assign contractors
   */
  static canAssignContractor(user: User): boolean {
    return user.role === UserRole.EE || user.role === UserRole.CE;
  }
  
  /**
   * Check if user can escalate complaints
   */
  static canEscalateComplaint(user: User): boolean {
    return user.role === UserRole.EE; // Only EE can escalate to CE
  }
}
```

### Complaint Validator
```typescript
class ComplaintValidator {
  /**
   * Validate complaint data before submission
   */
  static validateComplaintData(data: Partial<Complaint>): ValidationResult {
    const errors: string[] = [];
    
    if (!data.description || data.description.trim().length < 10) {
      errors.push('Description must be at least 10 characters');
    }
    
    if (!data.location || !this.isValidCoordinate(data.location)) {
      errors.push('Valid location coordinates required');
    }
    
    if (!data.damageType || !Object.values(DamageType).includes(data.damageType)) {
      errors.push('Valid damage type required');
    }
    
    if (!data.district || !data.zone) {
      errors.push('District and zone are required');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Validate status transition
   */
  static isValidStatusTransition(from: ComplaintStatus, to: ComplaintStatus): boolean {
    const validTransitions: Record<ComplaintStatus, ComplaintStatus[]> = {
      [ComplaintStatus.PENDING]: [ComplaintStatus.IN_PROGRESS, ComplaintStatus.REJECTED],
      [ComplaintStatus.IN_PROGRESS]: [ComplaintStatus.RESOLVED, ComplaintStatus.REJECTED],
      [ComplaintStatus.RESOLVED]: [], // Terminal state
      [ComplaintStatus.REJECTED]: []  // Terminal state
    };
    
    return validTransitions[from]?.includes(to) ?? false;
  }
}
```

### SLA Calculator
```typescript
class SLACalculator {
  /**
   * Calculate SLA deadline based on severity and road type
   */
  static calculateSLADeadline(
    severity: Severity,
    roadType: RoadType,
    createdAt: Date
  ): Date {
    const slaHours = this.getSLAHours(severity, roadType);
    const deadline = new Date(createdAt);
    deadline.setHours(deadline.getHours() + slaHours);
    return deadline;
  }
  
  private static getSLAHours(severity: Severity, roadType: RoadType): number {
    const slaMatrix: Record<Severity, Record<RoadType, number>> = {
      [Severity.CRITICAL]: {
        [RoadType.NATIONAL_HIGHWAY]: 4,
        [RoadType.STATE_HIGHWAY]: 8,
        [RoadType.DISTRICT_ROAD]: 12,
        [RoadType.VILLAGE_ROAD]: 24,
        [RoadType.CITY_ROAD]: 8
      },
      [Severity.HIGH]: {
        [RoadType.NATIONAL_HIGHWAY]: 24,
        [RoadType.STATE_HIGHWAY]: 48,
        [RoadType.DISTRICT_ROAD]: 72,
        [RoadType.VILLAGE_ROAD]: 168,
        [RoadType.CITY_ROAD]: 48
      },
      [Severity.MEDIUM]: {
        [RoadType.NATIONAL_HIGHWAY]: 72,
        [RoadType.STATE_HIGHWAY]: 168,
        [RoadType.DISTRICT_ROAD]: 336,
        [RoadType.VILLAGE_ROAD]: 720,
        [RoadType.CITY_ROAD]: 168
      },
      [Severity.LOW]: {
        [RoadType.NATIONAL_HIGHWAY]: 168,
        [RoadType.STATE_HIGHWAY]: 336,
        [RoadType.DISTRICT_ROAD]: 720,
        [RoadType.VILLAGE_ROAD]: 1440,
        [RoadType.CITY_ROAD]: 336
      }
    };
    
    return slaMatrix[severity][roadType];
  }
  
  /**
   * Check if complaint is overdue
   */
  static isOverdue(complaint: Complaint, roadType: RoadType): boolean {
    const deadline = this.calculateSLADeadline(
      complaint.severity,
      roadType,
      complaint.createdAt
    );
    
    return new Date() > deadline && 
           complaint.status !== ComplaintStatus.RESOLVED &&
           complaint.status !== ComplaintStatus.REJECTED;
  }
}
```

## Utility Functions

### Geographic Utilities
```typescript
class GeoUtils {
  /**
   * Validate geographic coordinates
   */
  static isValidCoordinate(coord: GeoCoordinate): boolean {
    return coord.lat >= -90 && coord.lat <= 90 &&
           coord.lng >= -180 && coord.lng <= 180;
  }
  
  /**
   * Check if coordinates are within India bounds
   */
  static isWithinIndiaBounds(coord: GeoCoordinate): boolean {
    const INDIA_BOUNDS = {
      north: 37.6,
      south: 6.4,
      east: 97.25,
      west: 68.7
    };
    
    return coord.lat >= INDIA_BOUNDS.south &&
           coord.lat <= INDIA_BOUNDS.north &&
           coord.lng >= INDIA_BOUNDS.west &&
           coord.lng <= INDIA_BOUNDS.east;
  }
  
  /**
   * Calculate distance between two points in meters
   */
  static calculateDistance(point1: GeoCoordinate, point2: GeoCoordinate): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = point1.lat * Math.PI / 180;
    const φ2 = point2.lat * Math.PI / 180;
    const Δφ = (point2.lat - point1.lat) * Math.PI / 180;
    const Δλ = (point2.lng - point1.lng) * Math.PI / 180;
    
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }
  
  /**
   * Check if point is within distance of line segment
   */
  static isNearRoad(
    point: GeoCoordinate,
    roadGeometry: GeoJSON.LineString,
    maxDistanceMeters: number = 100
  ): boolean {
    const coordinates = roadGeometry.coordinates;
    
    for (let i = 0; i < coordinates.length - 1; i++) {
      const segmentStart = { lng: coordinates[i][0], lat: coordinates[i][1] };
      const segmentEnd = { lng: coordinates[i + 1][0], lat: coordinates[i + 1][1] };
      
      const distance = this.distanceToLineSegment(point, segmentStart, segmentEnd);
      if (distance <= maxDistanceMeters) {
        return true;
      }
    }
    
    return false;
  }
}
```

### Notification Topic Generator
```typescript
class NotificationTopicGenerator {
  /**
   * Generate FCM topic for user notifications
   */
  static getUserTopic(userId: string): string {
    return `user_${userId}`;
  }
  
  /**
   * Generate FCM topic for jurisdiction notifications
   */
  static getJurisdictionTopic(district: string, zone: string): string {
    return `jurisdiction_${district}_${zone}`;
  }
  
  /**
   * Generate FCM topic for road-specific notifications
   */
  static getRoadTopic(roadId: string): string {
    return `road_${roadId}`;
  }
  
  /**
   * Generate FCM topic for authority notifications
   */
  static getAuthorityTopic(authorityId: string): string {
    return `authority_${authorityId}`;
  }
  
  /**
   * Generate FCM topic for contractor notifications
   */
  static getContractorTopic(contractorId: string): string {
    return `contractor_${contractorId}`;
  }
}
```

## Validation Schemas (Zod)

### Complaint Schema
```typescript
const ComplaintSchema = z.object({
  id: z.string().min(1),
  roadId: z.string().min(1),
  district: z.string().min(1),
  zone: z.string().min(1),
  description: z.string().min(10).max(1000),
  damageType: z.nativeEnum(DamageType),
  severity: z.nativeEnum(Severity),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  }),
  status: z.nativeEnum(ComplaintStatus).default(ComplaintStatus.PENDING)
});
```

### User Schema
```typescript
const UserSchema = z.object({
  id: z.string().uuid(),
  phone: z.string().regex(/^\+91[6-9]\d{9}$/),
  role: z.nativeEnum(UserRole),
  districts: z.array(z.string()).min(1),
  zones: z.array(z.string()).min(1),
  govtId: z.string().optional()
});
```

## Constants & Configuration

### System Constants
```typescript
export const SYSTEM_CONSTANTS = {
  MAX_COMPLAINT_DESCRIPTION_LENGTH: 1000,
  MIN_COMPLAINT_DESCRIPTION_LENGTH: 10,
  MAX_ROAD_PROXIMITY_METERS: 100,
  DEFAULT_SLA_HOURS: 72,
  MAX_ATTACHMENT_SIZE_MB: 15,
  SUPPORTED_IMAGE_FORMATS: ['jpg', 'jpeg', 'png', 'webp'],
  SUPPORTED_VIDEO_FORMATS: ['mp4', 'mov', 'avi'],
  INDIA_COUNTRY_CODE: 'IN',
  DEFAULT_TIMEZONE: 'Asia/Kolkata'
} as const;
```

### Error Codes
```typescript
export enum ErrorCode {
  INVALID_COORDINATES = 'INVALID_COORDINATES',
  COMPLAINT_NOT_FOUND = 'COMPLAINT_NOT_FOUND',
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',
  ROAD_NOT_FOUND = 'ROAD_NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  CONTRACTOR_NOT_AVAILABLE = 'CONTRACTOR_NOT_AVAILABLE',
  SLA_VIOLATION = 'SLA_VIOLATION'
}
```

## Export Structure
```typescript
// Main exports
export * from './entities';
export * from './enums';
export * from './validators';
export * from './utils';
export * from './constants';
export * from './errors';

// Business logic
export { PermissionGatekeeper } from './business/PermissionGatekeeper';
export { ComplaintValidator } from './business/ComplaintValidator';
export { SLACalculator } from './business/SLACalculator';
export { NotificationTopicGenerator } from './business/NotificationTopicGenerator';

// Utilities
export { GeoUtils } from './utils/GeoUtils';
export { DateUtils } from './utils/DateUtils';
export { ValidationUtils } from './utils/ValidationUtils';
```

## Usage Examples

### Validating Complaint Data
```typescript
import { ComplaintValidator, ComplaintSchema } from '@roadwatch/core';

const complaintData = {
  description: 'Large pothole on main road',
  location: { lat: 28.6139, lng: 77.2090 },
  damageType: DamageType.POTHOLE,
  severity: Severity.HIGH,
  district: 'Delhi',
  zone: 'Central'
};

const validation = ComplaintValidator.validateComplaintData(complaintData);
if (!validation.isValid) {
  console.error('Validation errors:', validation.errors);
}
```

### Checking Permissions
```typescript
import { PermissionGatekeeper } from '@roadwatch/core';

const canUpdate = PermissionGatekeeper.canUpdateComplaintStatus(user, complaint);
if (!canUpdate) {
  throw new Error('Insufficient permissions');
}
```

### Calculating SLA
```typescript
import { SLACalculator } from '@roadwatch/core';

const deadline = SLACalculator.calculateSLADeadline(
  Severity.CRITICAL,
  RoadType.NATIONAL_HIGHWAY,
  new Date()
);

const isOverdue = SLACalculator.isOverdue(complaint, roadType);
```