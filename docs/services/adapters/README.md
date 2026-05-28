# Adapters Service

## Overview
Country-specific business logic adapters that handle regional variations in complaint management, SLA calculations, authority hierarchies, and regulatory compliance. Provides pluggable implementations for different jurisdictions.

## Architecture
- **Pattern**: Adapter/Strategy pattern
- **Registry**: Centralized adapter management
- **Inheritance**: Base adapter with country-specific overrides
- **Configuration**: Environment-based adapter selection
- **Extensibility**: Easy addition of new country adapters

## Key Components

### Adapter Registry
Central registry for managing and selecting country-specific adapters based on configuration.

```typescript
class AdapterRegistry {
  private static instance: AdapterRegistry;
  private adapters = new Map<string, BaseAdapter>();
  
  static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }
  
  registerAdapter(countryCode: string, adapter: BaseAdapter): void {
    this.adapters.set(countryCode.toUpperCase(), adapter);
  }
  
  getAdapter(countryCode: string): BaseAdapter {
    const adapter = this.adapters.get(countryCode.toUpperCase());
    if (!adapter) {
      throw new Error(`No adapter found for country: ${countryCode}`);
    }
    return adapter;
  }
  
  getDefaultAdapter(): BaseAdapter {
    return this.getAdapter('DEFAULT');
  }
}
```

### Base Adapter
Abstract base class providing default implementations and interface definitions.

```typescript
abstract class BaseAdapter {
  abstract getCountryCode(): string;
  abstract getCountryName(): string;
  
  /**
   * Calculate SLA deadline based on local regulations
   */
  calculateSLADeadline(
    severity: Severity,
    roadType: RoadType,
    createdAt: Date
  ): Date {
    const slaHours = this.getSLAHours(severity, roadType);
    const deadline = new Date(createdAt);
    deadline.setHours(deadline.getHours() + slaHours);
    return deadline;
  }
  
  /**
   * Get authority hierarchy for escalation
   */
  abstract getAuthorityHierarchy(roadType: RoadType): AuthorityLevel[];
  
  /**
   * Validate complaint data according to local rules
   */
  validateComplaint(complaint: Partial<Complaint>): ValidationResult {
    const errors: string[] = [];
    
    // Base validation
    if (!complaint.description || complaint.description.length < 10) {
      errors.push('Description must be at least 10 characters');
    }
    
    // Country-specific validation
    const countryErrors = this.validateCountrySpecific(complaint);
    errors.push(...countryErrors);
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Check RTI eligibility based on local laws
   */
  abstract isRTIEligible(complaint: Complaint): boolean;
  
  /**
   * Format complaint ID according to local standards
   */
  abstract formatComplaintId(district: string, sequence: number): string;
  
  /**
   * Get local business hours for SLA calculations
   */
  getBusinessHours(): BusinessHours {
    return {
      start: 9,
      end: 17,
      workingDays: [1, 2, 3, 4, 5], // Monday to Friday
      holidays: []
    };
  }
  
  protected abstract getSLAHours(severity: Severity, roadType: RoadType): number;
  protected abstract validateCountrySpecific(complaint: Partial<Complaint>): string[];
}
```

## India Adapter Implementation

### Core Implementation
```typescript
class IndiaAdapter extends BaseAdapter {
  getCountryCode(): string {
    return 'IN';
  }
  
  getCountryName(): string {
    return 'India';
  }
  
  /**
   * India-specific authority hierarchy
   */
  getAuthorityHierarchy(roadType: RoadType): AuthorityLevel[] {
    switch (roadType) {
      case RoadType.NATIONAL_HIGHWAY:
        return [
          { name: 'NHAI Regional Office', level: 1 },
          { name: 'NHAI Zonal Office', level: 2 },
          { name: 'NHAI Headquarters', level: 3 }
        ];
      
      case RoadType.STATE_HIGHWAY:
        return [
          { name: 'PWD Division', level: 1 },
          { name: 'PWD Circle', level: 2 },
          { name: 'PWD Headquarters', level: 3 }
        ];
      
      case RoadType.DISTRICT_ROAD:
      case RoadType.VILLAGE_ROAD:
        return [
          { name: 'Block Development Office', level: 1 },
          { name: 'District Collector', level: 2 },
          { name: 'State Government', level: 3 }
        ];
      
      default:
        return [
          { name: 'Local Authority', level: 1 },
          { name: 'Municipal Corporation', level: 2 },
          { name: 'State Urban Development', level: 3 }
        ];
    }
  }
  
  /**
   * India-specific SLA matrix (in hours)
   */
  protected getSLAHours(severity: Severity, roadType: RoadType): number {
    const slaMatrix: Record<Severity, Record<RoadType, number>> = {
      [Severity.CRITICAL]: {
        [RoadType.NATIONAL_HIGHWAY]: 4,   // 4 hours for critical NH issues
        [RoadType.STATE_HIGHWAY]: 8,     // 8 hours for critical SH issues
        [RoadType.DISTRICT_ROAD]: 12,    // 12 hours for critical district roads
        [RoadType.VILLAGE_ROAD]: 24,     // 24 hours for critical village roads
        [RoadType.CITY_ROAD]: 8          // 8 hours for critical city roads
      },
      [Severity.HIGH]: {
        [RoadType.NATIONAL_HIGHWAY]: 24,
        [RoadType.STATE_HIGHWAY]: 48,
        [RoadType.DISTRICT_ROAD]: 72,
        [RoadType.VILLAGE_ROAD]: 168,    // 1 week
        [RoadType.CITY_ROAD]: 48
      },
      [Severity.MEDIUM]: {
        [RoadType.NATIONAL_HIGHWAY]: 72,
        [RoadType.STATE_HIGHWAY]: 168,
        [RoadType.DISTRICT_ROAD]: 336,   // 2 weeks
        [RoadType.VILLAGE_ROAD]: 720,    // 1 month
        [RoadType.CITY_ROAD]: 168
      },
      [Severity.LOW]: {
        [RoadType.NATIONAL_HIGHWAY]: 168,
        [RoadType.STATE_HIGHWAY]: 336,
        [RoadType.DISTRICT_ROAD]: 720,
        [RoadType.VILLAGE_ROAD]: 1440,   // 2 months
        [RoadType.CITY_ROAD]: 336
      }
    };
    
    return slaMatrix[severity][roadType];
  }
  
  /**
   * RTI eligibility based on Indian RTI Act 2005
   */
  isRTIEligible(complaint: Complaint): boolean {
    const daysSinceCreation = Math.floor(
      (Date.now() - complaint.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    // RTI eligible after 60 days of no resolution
    return daysSinceCreation >= 60 && 
           complaint.status !== ComplaintStatus.RESOLVED &&
           complaint.status !== ComplaintStatus.REJECTED;
  }
  
  /**
   * India-specific complaint ID format: RW-{STATE}-{DISTRICT}-{YYYYMMDD}-{SEQUENCE}
   */
  formatComplaintId(district: string, sequence: number): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const districtCode = this.getDistrictCode(district);
    const sequenceStr = sequence.toString().padStart(4, '0');
    
    return `RW-IN-${districtCode}-${dateStr}-${sequenceStr}`;
  }
  
  /**
   * India-specific validation rules
   */
  protected validateCountrySpecific(complaint: Partial<Complaint>): string[] {
    const errors: string[] = [];
    
    // Validate Indian coordinates
    if (complaint.location && !this.isWithinIndiaBounds(complaint.location)) {
      errors.push('Location must be within India boundaries');
    }
    
    // Validate Indian district codes
    if (complaint.district && !this.isValidIndianDistrict(complaint.district)) {
      errors.push('Invalid Indian district code');
    }
    
    // Validate pincode if provided
    if (complaint.pincode && !this.isValidIndianPincode(complaint.pincode)) {
      errors.push('Invalid Indian pincode format');
    }
    
    return errors;
  }
  
  /**
   * India business hours (considering local holidays)
   */
  getBusinessHours(): BusinessHours {
    return {
      start: 10,  // 10 AM IST
      end: 18,    // 6 PM IST
      workingDays: [1, 2, 3, 4, 5, 6], // Monday to Saturday
      holidays: this.getIndianHolidays(),
      timezone: 'Asia/Kolkata'
    };
  }
  
  /**
   * Calculate working hours excluding weekends and holidays
   */
  calculateWorkingHours(startDate: Date, endDate: Date): number {
    const businessHours = this.getBusinessHours();
    let workingHours = 0;
    const current = new Date(startDate);
    
    while (current < endDate) {
      const dayOfWeek = current.getDay();
      const isWorkingDay = businessHours.workingDays.includes(dayOfWeek);
      const isHoliday = this.isHoliday(current);
      
      if (isWorkingDay && !isHoliday) {
        const dayStart = new Date(current);
        dayStart.setHours(businessHours.start, 0, 0, 0);
        
        const dayEnd = new Date(current);
        dayEnd.setHours(businessHours.end, 0, 0, 0);
        
        const effectiveStart = new Date(Math.max(startDate.getTime(), dayStart.getTime()));
        const effectiveEnd = new Date(Math.min(endDate.getTime(), dayEnd.getTime()));
        
        if (effectiveStart < effectiveEnd) {
          workingHours += (effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60);
        }
      }
      
      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
    }
    
    return workingHours;
  }
  
  // Helper methods
  private getDistrictCode(district: string): string {
    // Map district names to standard codes
    const districtCodes: Record<string, string> = {
      'Delhi': 'DL',
      'Mumbai': 'MH',
      'Bangalore': 'KA',
      'Chennai': 'TN',
      'Kolkata': 'WB',
      'Hyderabad': 'TS',
      'Pune': 'MH',
      'Ahmedabad': 'GJ'
      // Add more mappings as needed
    };
    
    return districtCodes[district] || district.slice(0, 2).toUpperCase();
  }
  
  private isWithinIndiaBounds(location: GeoCoordinate): boolean {
    const INDIA_BOUNDS = {
      north: 37.6,
      south: 6.4,
      east: 97.25,
      west: 68.7
    };
    
    return location.lat >= INDIA_BOUNDS.south &&
           location.lat <= INDIA_BOUNDS.north &&
           location.lng >= INDIA_BOUNDS.west &&
           location.lng <= INDIA_BOUNDS.east;
  }
  
  private isValidIndianDistrict(district: string): boolean {
    // Validate against list of Indian districts
    // This would typically be loaded from a configuration file
    return district.length >= 2 && district.length <= 50;
  }
  
  private isValidIndianPincode(pincode: string): boolean {
    // Indian pincode format: 6 digits
    return /^[1-9][0-9]{5}$/.test(pincode);
  }
  
  private getIndianHolidays(): Date[] {
    // Return list of Indian national holidays
    // This would typically be loaded from a configuration service
    const currentYear = new Date().getFullYear();
    return [
      new Date(currentYear, 0, 26),   // Republic Day
      new Date(currentYear, 7, 15),   // Independence Day
      new Date(currentYear, 9, 2),    // Gandhi Jayanti
      // Add more holidays as needed
    ];
  }
  
  private isHoliday(date: Date): boolean {
    const holidays = this.getIndianHolidays();
    return holidays.some(holiday => 
      holiday.getDate() === date.getDate() &&
      holiday.getMonth() === date.getMonth() &&
      holiday.getFullYear() === date.getFullYear()
    );
  }
}
```

## Adapter Configuration

### Registration and Setup
```typescript
// Initialize adapters
const registry = AdapterRegistry.getInstance();

// Register India adapter
registry.registerAdapter('IN', new IndiaAdapter());

// Register default adapter for fallback
registry.registerAdapter('DEFAULT', new DefaultAdapter());

// Usage in application
const getCountryAdapter = (countryCode: string): BaseAdapter => {
  try {
    return registry.getAdapter(countryCode);
  } catch (error) {
    console.warn(`Adapter not found for ${countryCode}, using default`);
    return registry.getDefaultAdapter();
  }
};
```

### Environment-based Selection
```typescript
interface AdapterConfig {
  defaultCountry: string;
  enabledCountries: string[];
  customAdapters?: Record<string, string>;
}

const adapterConfig: AdapterConfig = {
  defaultCountry: process.env.DEFAULT_COUNTRY || 'IN',
  enabledCountries: (process.env.ENABLED_COUNTRIES || 'IN').split(','),
  customAdapters: JSON.parse(process.env.CUSTOM_ADAPTERS || '{}')
};
```

## Usage Examples

### SLA Calculation
```typescript
const adapter = getCountryAdapter('IN');
const deadline = adapter.calculateSLADeadline(
  Severity.HIGH,
  RoadType.NATIONAL_HIGHWAY,
  new Date()
);

console.log(`SLA deadline: ${deadline.toISOString()}`);
```

### Authority Escalation
```typescript
const adapter = getCountryAdapter('IN');
const hierarchy = adapter.getAuthorityHierarchy(RoadType.STATE_HIGHWAY);

console.log('Escalation path:', hierarchy.map(level => level.name));
```

### RTI Eligibility Check
```typescript
const adapter = getCountryAdapter('IN');
const isEligible = adapter.isRTIEligible(complaint);

if (isEligible) {
  console.log('Complaint is eligible for RTI application');
}
```

### Complaint Validation
```typescript
const adapter = getCountryAdapter('IN');
const validation = adapter.validateComplaint(complaintData);

if (!validation.isValid) {
  console.error('Validation errors:', validation.errors);
}
```

## Extending for New Countries

### Creating a New Adapter
```typescript
class USAdapter extends BaseAdapter {
  getCountryCode(): string {
    return 'US';
  }
  
  getCountryName(): string {
    return 'United States';
  }
  
  getAuthorityHierarchy(roadType: RoadType): AuthorityLevel[] {
    switch (roadType) {
      case RoadType.NATIONAL_HIGHWAY:
        return [
          { name: 'State DOT', level: 1 },
          { name: 'Federal Highway Administration', level: 2 }
        ];
      
      default:
        return [
          { name: 'City Public Works', level: 1 },
          { name: 'County Government', level: 2 },
          { name: 'State DOT', level: 3 }
        ];
    }
  }
  
  protected getSLAHours(severity: Severity, roadType: RoadType): number {
    // US-specific SLA matrix
    // Implementation here
  }
  
  isRTIEligible(complaint: Complaint): boolean {
    // US Freedom of Information Act (FOIA) rules
    return true; // FOIA generally allows information requests
  }
  
  formatComplaintId(district: string, sequence: number): string {
    // US-specific format
    return `US-${district}-${Date.now()}-${sequence}`;
  }
  
  protected validateCountrySpecific(complaint: Partial<Complaint>): string[] {
    // US-specific validation rules
    return [];
  }
}
```

### Registration
```typescript
// Register the new adapter
registry.registerAdapter('US', new USAdapter());
```

## Testing Adapters

### Unit Tests
```typescript
describe('IndiaAdapter', () => {
  let adapter: IndiaAdapter;
  
  beforeEach(() => {
    adapter = new IndiaAdapter();
  });
  
  test('should calculate correct SLA for critical national highway', () => {
    const deadline = adapter.calculateSLADeadline(
      Severity.CRITICAL,
      RoadType.NATIONAL_HIGHWAY,
      new Date('2024-01-01T10:00:00Z')
    );
    
    expect(deadline).toEqual(new Date('2024-01-01T14:00:00Z')); // 4 hours later
  });
  
  test('should validate Indian coordinates', () => {
    const validComplaint = {
      location: { lat: 28.6139, lng: 77.2090 }, // Delhi
      district: 'Delhi'
    };
    
    const result = adapter.validateComplaint(validComplaint);
    expect(result.isValid).toBe(true);
  });
  
  test('should reject coordinates outside India', () => {
    const invalidComplaint = {
      location: { lat: 40.7128, lng: -74.0060 }, // New York
      district: 'Delhi'
    };
    
    const result = adapter.validateComplaint(invalidComplaint);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Location must be within India boundaries');
  });
});
```

## Performance Considerations
- Lazy loading of adapter configurations
- Caching of frequently accessed data (holidays, district codes)
- Efficient validation algorithms
- Minimal memory footprint for mobile applications
- Fast adapter lookup and selection

## Security Considerations
- Input validation for all adapter methods
- Sanitization of country-specific data
- Protection against injection attacks in custom validation rules
- Secure handling of sensitive regional information