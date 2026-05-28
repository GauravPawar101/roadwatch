# Providers Service

## Overview
Infrastructure provider packages that handle external integrations and cross-cutting concerns. Includes Kafka messaging, storage solutions, routing engines, and other third-party service integrations.

## Architecture
- **Pattern**: Provider/Adapter pattern
- **Modularity**: Pluggable implementations
- **Configuration**: Environment-based selection
- **Abstraction**: Interface-based design
- **Scalability**: Support for multiple backends

## Provider Packages

### Kafka Provider (`providers/kafka`)
Event streaming and message queue integration using local Kafka (KafkaJS) for development and Docker deployments.

#### Key Components
- `KafkaClient.ts` - Client factory and connection management
- `KafkaProducer.ts` - Message publishing with retry logic
- `KafkaConsumer.ts` - Message consumption with error handling
- `topics.ts` - Topic definitions and event schemas
- `config.ts` - Environment-based configuration

#### Configuration
```typescript
interface KafkaConfig {
  brokers: string[];
  clientId: string;
  ssl?: boolean;
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username: string;
    password: string;
  };
}

// Local Kafka
const localConfig: KafkaConfig = {
  brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
  clientId: 'roadwatch-client'
};

// Local Kafka
const localConfig: KafkaConfig = {
  brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
  clientId: 'roadwatch-client'
};
```

#### Event Topics
```typescript
export const KafkaTopics = {
  complaintSubmitted: 'complaint-submitted',
  complaintAnchored: 'complaint-anchored',
  complaintStatusChanged: 'complaint-status-changed',
  mediaCaptured: 'media-captured',
  mediaCompressed: 'media-compressed',
  mediaUploaded: 'media-uploaded',
  mediaAnalyzed: 'media-analyzed',
  escalationDue: 'escalation-due',
  escalationSent: 'escalation-sent',
  fabricEvents: 'fabric-events',
  authorityAction: 'authority-action',
  notificationSend: 'notification-send',
  dlq: 'dlq-events'
} as const;
```

### Storage Provider (`providers/storage-sqlite`)
SQLite-based local storage for mobile applications with offline support.

### Fabric Provider (`providers/fabric`)
Hyperledger Fabric blockchain integration provider for immutable complaint records.

#### Key Components
- `SQLiteStorage.ts` - Main storage interface
- `DatabaseManager.ts` - Connection and migration management
- `QueryBuilder.ts` - Type-safe query construction
- `migrations/` - Database schema migrations

#### Database Schema
```typescript
interface StorageSchema {
  complaints: {
    id: string;
    server_id?: string;
    district: string;
    zone: string;
    description: string;
    lat: number;
    lng: number;
    status: string;
    created_at: string;
    updated_at: string;
    sync_status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  };
  
  complaint_photos: {
    id: string;
    complaint_id: string;
    uri: string;
    type: string;
    name: string;
    size: number;
    uploaded: boolean;
  };
  
  roads_cache: {
    id: string;
    district_id: string;
    name: string;
    road_type: string;
    geometry?: string;
    cached_at: string;
  };
}
```

### Routing Provider (`providers/routing-local`)
Local routing engine for calculating distances and finding nearest roads.

#### Key Components
- `RoutingEngine.ts` - Main routing interface
- `GeospatialIndex.ts` - Spatial indexing for fast lookups
- `PathCalculator.ts` - Distance and route calculations
- `RoadMatcher.ts` - Road segment matching logic

#### Routing Functions
```typescript
class LocalRoutingEngine {
  /**
   * Find nearest road to a given point
   */
  async findNearestRoad(
    point: GeoCoordinate,
    maxDistanceMeters: number = 100
  ): Promise<NearestRoadResult | null> {
    const spatialIndex = await this.getSpatialIndex();
    const candidates = spatialIndex.query(point, maxDistanceMeters);
    
    let nearest: NearestRoadResult | null = null;
    let minDistance = Infinity;
    
    for (const road of candidates) {
      const distance = this.calculateDistanceToRoad(point, road.geometry);
      if (distance < minDistance && distance <= maxDistanceMeters) {
        minDistance = distance;
        nearest = {
          road,
          distance,
          nearestPoint: this.findNearestPointOnRoad(point, road.geometry)
        };
      }
    }
    
    return nearest;
  }
  
  /**
   * Calculate route between two points
   */
  async calculateRoute(
    start: GeoCoordinate,
    end: GeoCoordinate
  ): Promise<RouteResult> {
    // Implementation for local routing
    // Could use OSM data or other local datasets
  }
}
```

## Provider Interfaces

### Storage Interface
```typescript
interface StorageProvider {
  initialize(): Promise<void>;
  store<T>(collection: string, id: string, data: T): Promise<void>;
  retrieve<T>(collection: string, id: string): Promise<T | null>;
  query<T>(collection: string, filter: QueryFilter): Promise<T[]>;
  delete(collection: string, id: string): Promise<void>;
  clear(collection: string): Promise<void>;
}
```

### Messaging Interface
```typescript
interface MessagingProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(topic: string, message: any, options?: PublishOptions): Promise<void>;
  subscribe(topic: string, handler: MessageHandler): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
}
```

### Routing Interface
```typescript
interface RoutingProvider {
  findNearestRoad(point: GeoCoordinate, maxDistance?: number): Promise<NearestRoadResult | null>;
  calculateRoute(start: GeoCoordinate, end: GeoCoordinate): Promise<RouteResult>;
  isPointOnRoad(point: GeoCoordinate, roadId: string, tolerance?: number): Promise<boolean>;
}
```

## Configuration Management

### Provider Selection
```typescript
class ProviderFactory {
  static createKafkaProvider(): MessagingProvider {
    if (isUpstashKafkaConfigured()) {
      return new UpstashKafkaProvider(getUpstashConfig());
    } else {
      return new LocalKafkaProvider(getLocalKafkaConfig());
    }
  }
  
  static createStorageProvider(): StorageProvider {
    const platform = Platform.OS;
    
    if (platform === 'ios' || platform === 'android') {
      return new SQLiteStorageProvider();
    } else {
      return new FileSystemStorageProvider();
    }
  }
  
  static createRoutingProvider(): RoutingProvider {
    const routingEngine = process.env.ROUTING_ENGINE || 'local';
    
    switch (routingEngine) {
      case 'google':
        return new GoogleMapsRoutingProvider();
      case 'mapbox':
        return new MapboxRoutingProvider();
      default:
        return new LocalRoutingProvider();
    }
  }
}
```

### Environment Configuration
```typescript
interface ProviderConfig {
  kafka: {
    provider: 'local' | 'upstash';
    brokers: string[];
    credentials?: {
      username: string;
      password: string;
    };
  };
  
  storage: {
    provider: 'sqlite' | 'filesystem' | 'memory';
    connectionString?: string;
    options?: Record<string, any>;
  };
  
  routing: {
    provider: 'local' | 'google' | 'mapbox';
    apiKey?: string;
    options?: Record<string, any>;
  };
}
```

## Error Handling & Resilience

### Retry Logic
```typescript
class RetryableProvider {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    backoffMs: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          break;
        }
        
        const delay = backoffMs * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }
    
    throw lastError!;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### Circuit Breaker
```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private failureThreshold: number = 5,
    private timeoutMs: number = 60000
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
}
```

## Performance Optimization

### Connection Pooling
```typescript
class ConnectionPool<T> {
  private pool: T[] = [];
  private activeConnections = 0;
  
  constructor(
    private factory: () => Promise<T>,
    private maxConnections: number = 10,
    private minConnections: number = 2
  ) {}
  
  async acquire(): Promise<T> {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    
    if (this.activeConnections < this.maxConnections) {
      this.activeConnections++;
      return await this.factory();
    }
    
    // Wait for connection to become available
    return new Promise((resolve) => {
      const checkPool = () => {
        if (this.pool.length > 0) {
          resolve(this.pool.pop()!);
        } else {
          setTimeout(checkPool, 10);
        }
      };
      checkPool();
    });
  }
  
  release(connection: T): void {
    if (this.pool.length < this.minConnections) {
      this.pool.push(connection);
    } else {
      this.activeConnections--;
      // Close connection if needed
    }
  }
}
```

### Caching Layer
```typescript
class CacheProvider {
  private cache = new Map<string, CacheEntry>();
  
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.value as T;
  }
  
  set<T>(key: string, value: T, ttlMs: number = 300000): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }
  
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
}

interface CacheEntry {
  value: any;
  expiresAt: number;
}
```

## Monitoring & Observability

### Metrics Collection
```typescript
class ProviderMetrics {
  private metrics = new Map<string, number>();
  
  incrementCounter(name: string, value: number = 1): void {
    const current = this.metrics.get(name) || 0;
    this.metrics.set(name, current + value);
  }
  
  recordLatency(name: string, startTime: number): void {
    const latency = Date.now() - startTime;
    this.incrementCounter(`${name}_latency_total`, latency);
    this.incrementCounter(`${name}_requests_total`);
  }
  
  getMetrics(): Record<string, number> {
    return Object.fromEntries(this.metrics);
  }
}
```

### Health Checks
```typescript
interface HealthCheck {
  name: string;
  check(): Promise<HealthStatus>;
}

interface HealthStatus {
  healthy: boolean;
  message?: string;
  details?: Record<string, any>;
}

class ProviderHealthChecker {
  private checks: HealthCheck[] = [];
  
  addCheck(check: HealthCheck): void {
    this.checks.push(check);
  }
  
  async checkAll(): Promise<Record<string, HealthStatus>> {
    const results: Record<string, HealthStatus> = {};
    
    await Promise.all(
      this.checks.map(async (check) => {
        try {
          results[check.name] = await check.check();
        } catch (error) {
          results[check.name] = {
            healthy: false,
            message: (error as Error).message
          };
        }
      })
    );
    
    return results;
  }
}
```

## Fabric Provider Implementation

### Blockchain Integration
```typescript
// Fabric blockchain provider
export class FabricProvider implements IBlockchainProvider {
  private gateway: Gateway;
  private network: Network;
  private contract: Contract;
  
  constructor(private config: FabricConfig) {
    this.gateway = new Gateway();
  }
  
  async connect(): Promise<void> {
    const wallet = await Wallets.newFileSystemWallet(this.config.walletPath);
    const connectionProfile = JSON.parse(
      fs.readFileSync(this.config.connectionProfilePath, 'utf8')
    );
    
    await this.gateway.connect(connectionProfile, {
      wallet,
      identity: this.config.userId,
      discovery: { enabled: true, asLocalhost: true }
    });
    
    this.network = await this.gateway.getNetwork(this.config.channelName);
    this.contract = this.network.getContract(this.config.chaincodeName);
  }
  
  async submitTransaction(functionName: string, ...args: string[]): Promise<string> {
    const result = await this.contract.submitTransaction(functionName, ...args);
    return result.toString();
  }
  
  async evaluateTransaction(functionName: string, ...args: string[]): Promise<string> {
    const result = await this.contract.evaluateTransaction(functionName, ...args);
    return result.toString();
  }
  
  async disconnect(): Promise<void> {
    this.gateway.disconnect();
  }
}
```

### Complaint Blockchain Operations
```typescript
// Blockchain service for complaints
export class ComplaintBlockchainService {
  constructor(private fabricProvider: FabricProvider) {}
  
  async recordComplaint(complaint: Complaint): Promise<string> {
    const complaintData = {
      id: complaint.id,
      title: complaint.title,
      category: complaint.category,
      location: complaint.location,
      status: complaint.status,
      timestamp: complaint.submittedAt.toISOString(),
      citizenId: complaint.citizenId,
      hash: this.calculateHash(complaint)
    };
    
    return await this.fabricProvider.submitTransaction(
      'CreateComplaint',
      JSON.stringify(complaintData)
    );
  }
  
  async updateComplaintStatus(complaintId: string, status: string, updatedBy: string): Promise<string> {
    const updateData = {
      complaintId,
      status,
      updatedBy,
      timestamp: new Date().toISOString()
    };
    
    return await this.fabricProvider.submitTransaction(
      'UpdateComplaintStatus',
      JSON.stringify(updateData)
    );
  }
  
  async getComplaintHistory(complaintId: string): Promise<ComplaintHistoryEntry[]> {
    const result = await this.fabricProvider.evaluateTransaction(
      'GetComplaintHistory',
      complaintId
    );
    
    return JSON.parse(result);
  }
  
  async verifyComplaintIntegrity(complaintId: string): Promise<boolean> {
    const result = await this.fabricProvider.evaluateTransaction(
      'VerifyComplaint',
      complaintId
    );
    
    return JSON.parse(result).isValid;
  }
  
  private calculateHash(complaint: Complaint): string {
    const data = `${complaint.id}${complaint.title}${complaint.category}${complaint.submittedAt.toISOString()}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
```

### Configuration
```typescript
interface FabricConfig {
  connectionProfilePath: string;
  walletPath: string;
  userId: string;
  channelName: string;
  chaincodeName: string;
  mspId: string;
  caUrl: string;
  peerUrl: string;
  ordererUrl: string;
}

export const fabricConfig: FabricConfig = {
  connectionProfilePath: process.env.FABRIC_CONNECTION_PROFILE || './config/connection-profile.json',
  walletPath: process.env.FABRIC_WALLET_PATH || './wallet',
  userId: process.env.FABRIC_USER_ID || 'appUser',
  channelName: process.env.FABRIC_CHANNEL_NAME || 'roadwatch-channel',
  chaincodeName: process.env.FABRIC_CHAINCODE_NAME || 'roadwatch-chaincode',
  mspId: process.env.FABRIC_MSP_ID || 'Org1MSP',
  caUrl: process.env.FABRIC_CA_URL || 'https://localhost:7054',
  peerUrl: process.env.FABRIC_PEER_URL || 'grpc://localhost:7051',
  ordererUrl: process.env.FABRIC_ORDERER_URL || 'grpc://localhost:7050'
};
```