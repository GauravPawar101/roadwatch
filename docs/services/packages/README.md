# Shared Packages

## Overview
Shared TypeScript packages that provide common functionality across all RoadWatch services. These packages follow a monorepo structure and are managed with pnpm workspaces.

## Package Architecture
- **Workspace Management**: pnpm workspaces for dependency management
- **Build System**: TypeScript with shared tsconfig.base.json
- **Versioning**: Workspace protocol for internal dependencies
- **Distribution**: Internal packages, not published to npm

## Package Structure

### Core Packages

#### `@roadwatch/core` (`packages/core`)
**Already documented** - See [Core Domain Service](../core/README.md)

#### `@roadwatch/adapters` (`packages/adapters`) 
**Already documented** - See [Adapters Service](../adapters/README.md)

#### `@roadwatch/providers` (`packages/providers`)
**Already documented** - See [Providers Service](../providers/README.md)

### Configuration Package

#### `@roadwatch/config` (`packages/config`)
Centralized configuration management and environment validation.

##### Key Components
```typescript
// Environment configuration with validation
interface AppConfig {
  database: {
    url: string;
    maxConnections: number;
    ssl: boolean;
  };
  kafka: {
    brokers: string[];
    clientId: string;
    ssl?: boolean;
  };
  fabric: {
    peerEndpoint: string;
    mspId: string;
    channelName: string;
    chaincodeName: string;
  };
  auth: {
    jwtSecret: string;
    otpExpiry: number;
  };
}

// Configuration loader with environment-specific overrides
class ConfigLoader {
  static load(environment: 'development' | 'staging' | 'production'): AppConfig {
    const baseConfig = this.loadBaseConfig();
    const envConfig = this.loadEnvironmentConfig(environment);
    return this.mergeConfigs(baseConfig, envConfig);
  }
  
  static validate(config: AppConfig): ValidationResult {
    // Validate all configuration values
    // Check required fields, format validation, etc.
  }
}
```

##### Configuration Files
- `config/base.json` - Base configuration
- `config/development.json` - Development overrides
- `config/staging.json` - Staging overrides  
- `config/production.json` - Production overrides

##### Environment Variables
```typescript
// Environment variable mapping
const ENV_MAPPING = {
  // Cassandra (primary)
  CASSANDRA_CONTACT_POINTS: 'database.contactPoints',
  CASSANDRA_KEYSPACE: 'database.keyspace',
  CASSANDRA_LOCAL_DC: 'database.localDc',
  // Legacy Postgres (optional/deprecated)
  DATABASE_URL: 'database.url', // Only for backward compatibility with legacy scripts
  KAFKA_BROKERS: 'kafka.brokers',
  FABRIC_PEER_ENDPOINT: 'fabric.peerEndpoint',
  JWT_SECRET: 'auth.jwtSecret'
} as const;
```

### Feature Packages

#### `@roadwatch/features` (`packages/features`)
React/React Native feature modules for mobile and web applications.

##### Feature Modules

**Feature Agent** (`packages/features/feature-agent`)
```typescript
// LLM-powered chat interface
interface AgentFeature {
  ChatInterface: React.FC<ChatInterfaceProps>;
  MessageBubble: React.FC<MessageBubbleProps>;
  InputField: React.FC<InputFieldProps>;
  TypingIndicator: React.FC;
}

// Agent service integration
class AgentService {
  async sendMessage(message: string, context?: ChatContext): Promise<AgentResponse>;
  async getConversationHistory(userId: string): Promise<ChatMessage[]>;
  streamResponse(message: string): AsyncIterable<string>;
}
```

**Feature Complaint** (`packages/features/feature-complaint`)
```typescript
// Complaint submission and tracking
interface ComplaintFeature {
  SubmissionForm: React.FC<SubmissionFormProps>;
  ComplaintList: React.FC<ComplaintListProps>;
  ComplaintDetail: React.FC<ComplaintDetailProps>;
  StatusTracker: React.FC<StatusTrackerProps>;
  MediaCapture: React.FC<MediaCaptureProps>;
}

// Complaint management hooks
const useComplaintSubmission = () => {
  const submitComplaint = async (data: ComplaintData) => {
    // Handle offline-first submission
    // Photo compression and upload
    // Location validation
  };
  
  return { submitComplaint, isSubmitting, error };
};
```

**Feature Map** (`packages/features/feature-map`)
```typescript
// Map visualization components
interface MapFeature {
  ComplaintMap: React.FC<ComplaintMapProps>;
  RoadOverlay: React.FC<RoadOverlayProps>;
  HeatmapLayer: React.FC<HeatmapLayerProps>;
  LocationPicker: React.FC<LocationPickerProps>;
}

// Map service integration
class MapService {
  async loadRoadSegments(bounds: GeoBounds): Promise<RoadSegment[]>;
  async findNearestRoad(location: GeoCoordinate): Promise<Road | null>;
  calculateDistance(point1: GeoCoordinate, point2: GeoCoordinate): number;
}
```

##### Shared Components
```typescript
// Common UI components across features
export const SharedComponents = {
  Button: React.FC<ButtonProps>,
  Input: React.FC<InputProps>,
  Modal: React.FC<ModalProps>,
  LoadingSpinner: React.FC<LoadingSpinnerProps>,
  ErrorBoundary: React.FC<ErrorBoundaryProps>
};

// Platform-specific implementations
export const PlatformComponents = Platform.select({
  ios: () => import('./ios/components'),
  android: () => import('./android/components'),
  web: () => import('./web/components')
});
```

### Test Utilities Package

#### `@roadwatch/test-utils` (`packages/test-utils`)
Shared testing utilities and mocks for consistent testing across services.

##### Test Helpers
```typescript
// Database test utilities
export class TestDatabase {
  static async setup(): Promise<TestDbInstance> {
    // Create isolated test database
    // Run migrations
    // Seed test data
  }
  
  static async cleanup(instance: TestDbInstance): Promise<void> {
    // Clean up test data
    // Close connections
  }
  
  static createMockUser(overrides?: Partial<User>): User {
    return {
      id: 'test-user-1',
      phone: '+911234567890',
      role: UserRole.CITIZEN,
      districts: ['Delhi'],
      zones: ['Central'],
      ...overrides
    };
  }
}

// API test utilities
export class TestApiClient {
  constructor(private baseUrl: string) {}
  
  async authenticateAs(user: User): Promise<string> {
    // Get test JWT token
  }
  
  async submitTestComplaint(data: Partial<ComplaintData>): Promise<string> {
    // Submit complaint with test data
  }
}

// Mock services
export const mockKafkaProducer = {
  publish: jest.fn().mockResolvedValue(undefined),
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined)
};

export const mockFabricGateway = {
  submitTransaction: jest.fn().mockResolvedValue('mock-tx-id'),
  evaluateTransaction: jest.fn().mockResolvedValue('mock-result')
};
```

##### Test Fixtures
```typescript
// Sample data for testing
export const TestFixtures = {
  complaints: {
    validComplaint: {
      district: 'Delhi',
      zone: 'Central',
      description: 'Large pothole on main road',
      lat: 28.6139,
      lng: 77.2090,
      damageType: DamageType.POTHOLE,
      severity: Severity.HIGH
    },
    
    invalidComplaint: {
      district: '',
      zone: 'Central',
      description: 'Too short',
      lat: 200, // Invalid latitude
      lng: 77.2090
    }
  },
  
  users: {
    citizen: {
      id: 'citizen-1',
      phone: '+911234567890',
      role: UserRole.CITIZEN,
      districts: ['Delhi'],
      zones: ['Central']
    },
    
    engineer: {
      id: 'engineer-1',
      phone: '+919876543210',
      role: UserRole.EE,
      districts: ['Delhi'],
      zones: ['Central', 'North']
    }
  }
};
```

### Platform Package

#### `@roadwatch/platforms` (`packages/platforms`)
Platform-specific implementations and utilities.

##### Platform Detection
```typescript
// Runtime platform detection
export const Platform = {
  OS: typeof window !== 'undefined' ? 'web' : 
      typeof process !== 'undefined' && process.versions?.node ? 'node' :
      'unknown',
  
  isWeb: () => Platform.OS === 'web',
  isNode: () => Platform.OS === 'node',
  isMobile: () => typeof navigator !== 'undefined' && 
                  /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
  
  select: <T>(options: {
    web?: T;
    node?: T;
    mobile?: T;
    default?: T;
  }): T => {
    if (Platform.isWeb() && options.web) return options.web;
    if (Platform.isNode() && options.node) return options.node;
    if (Platform.isMobile() && options.mobile) return options.mobile;
    return options.default!;
  }
};
```

##### Platform Adapters
```typescript
// Storage adapter
export const StorageAdapter = Platform.select({
  web: () => new WebStorageAdapter(localStorage),
  node: () => new FileSystemStorageAdapter(),
  mobile: () => new SQLiteStorageAdapter()
});

// Network adapter
export const NetworkAdapter = Platform.select({
  web: () => new FetchNetworkAdapter(),
  node: () => new NodeNetworkAdapter(),
  mobile: () => new ReactNativeNetworkAdapter()
});
```

## Package Dependencies

### Dependency Graph
```
@roadwatch/core
├── @roadwatch/config
└── @roadwatch/adapters

@roadwatch/adapters
├── @roadwatch/core
└── @roadwatch/config

@roadwatch/providers
├── @roadwatch/core
└── @roadwatch/config

@roadwatch/features
├── @roadwatch/core
├── @roadwatch/providers
└── react/react-native (peer)

@roadwatch/test-utils
├── @roadwatch/core
├── @roadwatch/config
└── jest/vitest (dev)

@roadwatch/platforms
└── (no internal dependencies)
```

### Workspace Configuration
```json
// pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "packages/core"
  - "packages/config"
  - "packages/features/*"
  - "packages/providers/*"
  - "packages/adapters/*"

// package.json workspace dependencies
{
  "dependencies": {
    "@roadwatch/core": "workspace:*",
    "@roadwatch/config": "workspace:*"
  }
}
```

## Build System

### TypeScript Configuration
```json
// tsconfig.base.json (shared)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}

// packages/*/tsconfig.json (extends base)
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../core" },
    { "path": "../config" }
  ]
}
```

### Build Scripts
```json
// Turbo configuration for parallel builds
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["build"]
    }
  }
}
```

## Usage Examples

### Configuration Usage
```typescript
import { ConfigLoader } from '@roadwatch/config';

const config = ConfigLoader.load(process.env.NODE_ENV);
const dbUrl = config.database.url;
```

### Feature Usage
```typescript
import { ComplaintSubmissionForm } from '@roadwatch/features/feature-complaint';

const MyApp = () => (
  <ComplaintSubmissionForm
    onSubmit={handleComplaintSubmit}
    onLocationSelect={handleLocationSelect}
  />
);
```

### Test Usage
```typescript
import { TestDatabase, TestFixtures } from '@roadwatch/test-utils';

describe('Complaint Service', () => {
  let db: TestDbInstance;
  
  beforeEach(async () => {
    db = await TestDatabase.setup();
  });
  
  afterEach(async () => {
    await TestDatabase.cleanup(db);
  });
  
  test('should create complaint', async () => {
    const complaint = TestFixtures.complaints.validComplaint;
    const result = await complaintService.create(complaint);
    expect(result.id).toBeDefined();
  });
});
```

## Maintenance & Updates
- Regular dependency updates across all packages
- Consistent TypeScript and linting configuration
- Shared CI/CD pipeline for all packages
- Version synchronization for workspace dependencies
- Breaking change coordination across packages