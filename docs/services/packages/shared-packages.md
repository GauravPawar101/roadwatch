# Shared Packages

## Overview
The RoadWatch system uses a monorepo structure with shared packages that provide common functionality across all services. These packages ensure consistency, reduce code duplication, and enable rapid development.

## Package Structure

### Core Packages
- **`packages/core/`** - Core business logic and domain models
- **`packages/config/`** - Configuration management and environment handling
- **`packages/providers/`** - Infrastructure provider abstractions
- **`packages/adapters/`** - Country and platform-specific adapters

### Feature Packages
- **`packages/features/`** - Modular feature implementations
- **`packages/platforms/`** - Platform-specific implementations
- **`packages/test-utils/`** - Shared testing utilities

## Core Package (`packages/core/`)

### Domain Models
```typescript
// Core domain entities
export interface Complaint {
  id: string;
  title: string;
  description: string;
  category: ComplaintCategory;
  location: Location;
  status: ComplaintStatus;
  priority: Priority;
  submittedAt: Date;
  updatedAt: Date;
  authorityId?: string;
  citizenId: string;
  attachments: Attachment[];
  escalationHistory: EscalationRecord[];
}

export interface Authority {
  id: string;
  name: string;
  type: AuthorityType;
  jurisdiction: string;
  contactInfo: ContactInfo;
  capabilities: string[];
  workingHours: WorkingHours;
  isActive: boolean;
}

export interface User {
  id: string;
  email: string;
  phone?: string;
  profile: UserProfile;
  role: UserRole;
  permissions: Permission[];
  createdAt: Date;
  lastLoginAt?: Date;
}
```

### Business Logic
```typescript
// Core business rules
export class ComplaintBusinessRules {
  static validateComplaint(complaint: CreateComplaintRequest): ValidationResult {
    const errors: string[] = [];
    
    if (!complaint.title || complaint.title.length < 10) {
      errors.push('Title must be at least 10 characters');
    }
    
    if (!complaint.description || complaint.description.length < 50) {
      errors.push('Description must be at least 50 characters');
    }
    
    if (!this.isValidLocation(complaint.location)) {
      errors.push('Valid location is required');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  static calculatePriority(complaint: Complaint): Priority {
    // Priority calculation logic based on category, location, etc.
    if (complaint.category === 'EMERGENCY') return 'CRITICAL';
    if (complaint.category === 'SAFETY_HAZARD') return 'HIGH';
    return 'MEDIUM';
  }
  
  static determineAuthority(location: Location): string[] {
    // Logic to determine which authorities should handle the complaint
    return AuthorityMatcher.findByJurisdiction(location);
  }
}
```

## Configuration Package (`packages/config/`)

### Environment Configuration
```typescript
// Environment-specific configuration
export interface AppConfig {
  server: {
    port: number;
    host: string;
    cors: CorsConfig;
  };
  database: {
    url: string;
    pool: PoolConfig;
    ssl: boolean;
  };
  redis: {
    url: string;
    ttl: number;
  };
  kafka: {
    brokers: string[];
    clientId: string;
    groupId: string;
  };
  blockchain: {
    networkUrl: string;
    channelName: string;
    chaincodeName: string;
  };
  auth: {
    jwtSecret: string;
    tokenExpiry: string;
    refreshTokenExpiry: string;
  };
}

export const getConfig = (): AppConfig => ({
  server: {
    port: parseInt(process.env.PORT || '3000'),
    host: process.env.HOST || 'localhost',
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3100'],
      credentials: true
    }
  },
  database: {
    // Cassandra-first configuration
    contactPoints: (process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1:9042').split(','),
    keyspace: process.env.CASSANDRA_KEYSPACE || 'roadwatch',
    localDc: process.env.CASSANDRA_LOCAL_DC || 'datacenter1'
  },
  // ... other config sections
});
```

### Feature Flags
```typescript
// Feature flag management
export interface FeatureFlags {
  enableBlockchain: boolean;
  enableAIAnalysis: boolean;
  enableRealTimeNotifications: boolean;
  enableAdvancedAnalytics: boolean;
  enableMobileApp: boolean;
}

export class FeatureFlagService {
  private flags: FeatureFlags;
  
  constructor(config: AppConfig) {
    this.flags = {
      enableBlockchain: config.features?.blockchain ?? true,
      enableAIAnalysis: config.features?.aiAnalysis ?? false,
      enableRealTimeNotifications: config.features?.realTime ?? true,
      enableAdvancedAnalytics: config.features?.analytics ?? false,
      enableMobileApp: config.features?.mobile ?? true
    };
  }
  
  isEnabled(feature: keyof FeatureFlags): boolean {
    return this.flags[feature];
  }
}
```

## Provider Package (`packages/providers/`)

### Database Provider
```typescript
// Database abstraction
export interface IDatabaseProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>;
}

export class PostgreSQLProvider implements IDatabaseProvider {
  private pool: Pool;
  
  constructor(config: DatabaseConfig) {
    this.pool = new Pool(config);
  }
  
  async connect(): Promise<void> {
    await this.pool.connect();
  }
  
  async query<T>(sql: string, params?: any[]): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      client.release();
    }
  }
}
```

### Cache Provider
```typescript
// Cache abstraction
export interface ICacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class RedisProvider implements ICacheProvider {
  private client: Redis;
  
  constructor(config: RedisConfig) {
    this.client = new Redis(config);
  }
  
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }
  
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttl) {
      await this.client.setex(key, ttl, serialized);
    } else {
      await this.client.set(key, serialized);
    }
  }
}
```

## Features Package (`packages/features/`)

### Feature Modules
```typescript
// Modular feature structure
export interface IFeature {
  name: string;
  version: string;
  dependencies: string[];
  initialize(context: FeatureContext): Promise<void>;
  cleanup(): Promise<void>;
}

// Complaint feature
export class ComplaintFeature implements IFeature {
  name = 'complaint';
  version = '1.0.0';
  dependencies = ['user', 'authority'];
  
  async initialize(context: FeatureContext): Promise<void> {
    // Register routes
    context.router.use('/complaints', complaintRoutes);
    
    // Register event handlers
    context.eventBus.on('complaint.created', this.handleComplaintCreated);
    
    // Register scheduled jobs
    context.scheduler.schedule('0 */6 * * *', this.processEscalations);
  }
  
  private handleComplaintCreated = async (event: ComplaintCreatedEvent) => {
    // Handle complaint creation logic
    await this.notificationService.notifyAuthorities(event.complaint);
    await this.analyticsService.trackComplaint(event.complaint);
  };
}

// Agent feature
export class AgentFeature implements IFeature {
  name = 'agent';
  version = '1.0.0';
  dependencies = ['complaint'];
  
  async initialize(context: FeatureContext): Promise<void> {
    // AI agent initialization
    context.router.use('/agent', agentRoutes);
    context.eventBus.on('complaint.created', this.analyzeComplaint);
  }
  
  private analyzeComplaint = async (event: ComplaintCreatedEvent) => {
    const analysis = await this.aiService.analyzeComplaint(event.complaint);
    await this.complaintService.updateAnalysis(event.complaint.id, analysis);
  };
}
```

### Feature Registry
```typescript
// Feature management
export class FeatureRegistry {
  private features = new Map<string, IFeature>();
  private initialized = new Set<string>();
  
  register(feature: IFeature): void {
    this.features.set(feature.name, feature);
  }
  
  async initializeAll(context: FeatureContext): Promise<void> {
    const sorted = this.topologicalSort();
    
    for (const featureName of sorted) {
      await this.initialize(featureName, context);
    }
  }
  
  private async initialize(name: string, context: FeatureContext): Promise<void> {
    if (this.initialized.has(name)) return;
    
    const feature = this.features.get(name);
    if (!feature) throw new Error(`Feature ${name} not found`);
    
    // Initialize dependencies first
    for (const dep of feature.dependencies) {
      await this.initialize(dep, context);
    }
    
    await feature.initialize(context);
    this.initialized.add(name);
  }
}
```

## Adapter Package (`packages/adapters/`)

### Country Adapters
```typescript
// Country-specific business logic
export interface ICountryAdapter {
  country: string;
  validateComplaint(complaint: CreateComplaintRequest): ValidationResult;
  formatAddress(location: Location): string;
  getAuthorityHierarchy(): AuthorityLevel[];
  getWorkingHours(): WorkingHours;
  getHolidays(): Date[];
}

export class IndiaAdapter implements ICountryAdapter {
  country = 'IN';
  
  validateComplaint(complaint: CreateComplaintRequest): ValidationResult {
    // India-specific validation
    const errors: string[] = [];
    
    if (!complaint.location.pincode) {
      errors.push('Pincode is required for Indian addresses');
    }
    
    if (complaint.category === 'ROAD_DAMAGE' && !complaint.roadType) {
      errors.push('Road type is required for road damage complaints');
    }
    
    return { isValid: errors.length === 0, errors };
  }
  
  formatAddress(location: Location): string {
    return `${location.address}, ${location.city}, ${location.state} - ${location.pincode}`;
  }
  
  getAuthorityHierarchy(): AuthorityLevel[] {
    return [
      { level: 1, name: 'Municipal Corporation', scope: 'CITY' },
      { level: 2, name: 'District Collector', scope: 'DISTRICT' },
      { level: 3, name: 'State Government', scope: 'STATE' },
      { level: 4, name: 'Central Government', scope: 'NATIONAL' }
    ];
  }
}
```

## Test Utils Package (`packages/test-utils/`)

### Testing Utilities
```typescript
// Shared testing utilities
export class TestDataFactory {
  static createComplaint(overrides: Partial<Complaint> = {}): Complaint {
    return {
      id: faker.string.uuid(),
      title: faker.lorem.sentence(),
      description: faker.lorem.paragraph(),
      category: faker.helpers.arrayElement(['ROAD_DAMAGE', 'TRAFFIC_VIOLATION']),
      location: this.createLocation(),
      status: 'SUBMITTED',
      priority: 'MEDIUM',
      submittedAt: new Date(),
      updatedAt: new Date(),
      citizenId: faker.string.uuid(),
      attachments: [],
      escalationHistory: [],
      ...overrides
    };
  }
  
  static createLocation(): Location {
    return {
      latitude: faker.location.latitude(),
      longitude: faker.location.longitude(),
      address: faker.location.streetAddress(),
      city: faker.location.city(),
      state: faker.location.state(),
      country: 'IN',
      pincode: faker.location.zipCode()
    };
  }
}

export class MockServices {
  static createMockKafkaProducer(): jest.Mocked<IKafkaProducer> {
    return {
      send: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined)
    };
  }
  
  static createMockRedisClient(): jest.Mocked<ICacheProvider> {
    const store = new Map<string, any>();
    
    return {
      get: jest.fn().mockImplementation((key) => Promise.resolve(store.get(key) || null)),
      set: jest.fn().mockImplementation((key, value) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      delete: jest.fn().mockImplementation((key) => {
        store.delete(key);
        return Promise.resolve();
      }),
      clear: jest.fn().mockImplementation(() => {
        store.clear();
        return Promise.resolve();
      })
    };
  }
}
```

## Package Management

### Monorepo Configuration
```json
{
  "name": "roadwatch-monorepo",
  "workspaces": [
    "packages/*",
    "apps/*",
    "services/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check"
  },
  "devDependencies": {
    "turbo": "^1.10.0",
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
```

### Turbo Configuration
```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "type-check": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

## Best Practices

### Package Design
- Keep packages focused and cohesive
- Define clear interfaces and contracts
- Minimize dependencies between packages
- Use dependency injection for flexibility
- Version packages independently when needed

### Code Organization
- Group related functionality in packages
- Use barrel exports for clean APIs
- Implement proper error handling
- Include comprehensive documentation
- Follow consistent naming conventions

### Testing Strategy
- Test packages in isolation
- Mock external dependencies
- Use shared test utilities
- Maintain high test coverage
- Include integration tests for critical paths