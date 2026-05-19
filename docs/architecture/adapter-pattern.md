# Adapter Model & Architecture

## Overview
The RoadWatch system uses the Adapter pattern extensively to provide flexible, pluggable implementations for different providers, countries, and platforms. This enables the system to support multiple infrastructure backends and business rules without changing core logic.

## Adapter Pattern Implementation

### Core Adapter Interface
```typescript
// Base adapter interface that all adapters must implement
interface BaseAdapter<TConfig, TResult> {
  initialize(config: TConfig): Promise<void>;
  isHealthy(): Promise<boolean>;
  getCapabilities(): string[];
  execute<T extends TResult>(operation: string, params: any[]): Promise<T>;
}

// Adapter registry for managing multiple adapters
class AdapterRegistry<T extends BaseAdapter<any, any>> {
  private adapters = new Map<string, T>();
  private defaultAdapter?: string;
  
  register(name: string, adapter: T): void {
    this.adapters.set(name, adapter);
  }
  
  setDefault(name: string): void {
    if (!this.adapters.has(name)) {
      throw new Error(`Adapter ${name} not found`);
    }
    this.defaultAdapter = name;
  }
  
  get(name?: string): T {
    const adapterName = name || this.defaultAdapter;
    if (!adapterName || !this.adapters.has(adapterName)) {
      throw new Error(`Adapter ${adapterName} not found`);
    }
    return this.adapters.get(adapterName)!;
  }
  
  list(): string[] {
    return Array.from(this.adapters.keys());
  }
}
```

## Infrastructure Adapters

### Storage Adapter Pattern
```typescript
// Storage adapter interface
interface StorageAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  query<T>(filter: QueryFilter): Promise<T[]>;
}

// SQLite implementation for mobile
class SQLiteStorageAdapter implements StorageAdapter {
  private db?: SQLiteDatabase;
  
  async connect(): Promise<void> {
    this.db = await SQLite.openDatabase({
      name: 'roadwatch.db',
      location: 'default'
    });
    await this.createTables();
  }
  
  async get<T>(key: string): Promise<T | null> {
    const result = await this.db!.executeSql(
      'SELECT value FROM storage WHERE key = ?',
      [key]
    );
    
    if (result[0].rows.length > 0) {
      return JSON.parse(result[0].rows.item(0).value);
    }
    return null;
  }
  
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const expiresAt = ttl ? Date.now() + (ttl * 1000) : null;
    
    await this.db!.executeSql(
      'INSERT OR REPLACE INTO storage (key, value, expires_at) VALUES (?, ?, ?)',
      [key, JSON.stringify(value), expiresAt]
    );
  }
}

// PostgreSQL implementation for server
class PostgreSQLStorageAdapter implements StorageAdapter {
  private pool: Pool;
  
  constructor(config: PostgreSQLConfig) {
    this.pool = new Pool(config);
  }
  
  async connect(): Promise<void> {
    await this.pool.connect();
  }
  
  async get<T>(key: string): Promise<T | null> {
    const result = await this.pool.query(
      'SELECT value FROM key_value_store WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())',
      [key]
    );
    
    if (result.rows.length > 0) {
      return JSON.parse(result.rows[0].value);
    }
    return null;
  }
  
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const expiresAt = ttl ? new Date(Date.now() + (ttl * 1000)) : null;
    
    await this.pool.query(
      'INSERT INTO key_value_store (key, value, expires_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = $3',
      [key, JSON.stringify(value), expiresAt]
    );
  }
}

// Storage adapter factory
class StorageAdapterFactory {
  static create(type: 'sqlite' | 'postgresql' | 'redis', config: any): StorageAdapter {
    switch (type) {
      case 'sqlite':
        return new SQLiteStorageAdapter();
      case 'postgresql':
        return new PostgreSQLStorageAdapter(config);
      case 'redis':
        return new RedisStorageAdapter(config);
      default:
        throw new Error(`Unknown storage adapter type: ${type}`);
    }
  }
}
```

### Messaging Adapter Pattern
```typescript
// Messaging adapter interface
interface MessagingAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(topic: string, message: any, options?: PublishOptions): Promise<void>;
  subscribe(topic: string, handler: MessageHandler): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
}

// Kafka implementation
class KafkaMessagingAdapter implements MessagingAdapter {
  private producer?: Producer;
  private consumer?: Consumer;
  private kafka: Kafka;
  
  constructor(config: KafkaConfig) {
    this.kafka = new Kafka(config);
  }
  
  async connect(): Promise<void> {
    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({ groupId: 'roadwatch-consumer' });
    
    await this.producer.connect();
    await this.consumer.connect();
  }
  
  async publish(topic: string, message: any, options?: PublishOptions): Promise<void> {
    await this.producer!.send({
      topic,
      messages: [{
        key: options?.key,
        value: JSON.stringify(message),
        headers: options?.headers
      }]
    });
  }
  
  async subscribe(topic: string, handler: MessageHandler): Promise<void> {
    await this.consumer!.subscribe({ topic });
    
    await this.consumer!.run({
      eachMessage: async ({ topic, partition, message }) => {
        const value = message.value ? JSON.parse(message.value.toString()) : null;
        await handler({ topic, partition, message: value });
      }
    });
  }
}

// Upstash Kafka implementation
class UpstashMessagingAdapter implements MessagingAdapter {
  private client: Kafka;
  
  constructor(config: UpstashKafkaConfig) {
    this.client = new Kafka({
      url: config.restUrl,
      username: config.username,
      password: config.password
    });
  }
  
  async publish(topic: string, message: any, options?: PublishOptions): Promise<void> {
    await this.client.produce(topic, JSON.stringify(message), {
      key: options?.key,
      headers: options?.headers
    });
  }
  
  // Upstash uses REST API, so subscription is different
  async subscribe(topic: string, handler: MessageHandler): Promise<void> {
    // Implement polling-based consumption for Upstash
    setInterval(async () => {
      const messages = await this.client.consume({
        consumerGroupId: 'roadwatch-consumer',
        instanceId: 'instance-1',
        topics: [topic],
        timeout: 1000
      });
      
      for (const msg of messages) {
        await handler({
          topic: msg.topic,
          partition: msg.partition,
          message: JSON.parse(msg.value)
        });
      }
    }, 5000);
  }
}
```

## Business Logic Adapters

### Country Adapter Pattern
```typescript
// Country-specific business logic adapter
abstract class CountryAdapter {
  abstract getCountryCode(): string;
  abstract getCountryName(): string;
  abstract calculateSLA(severity: Severity, roadType: RoadType): number;
  abstract getAuthorityHierarchy(roadType: RoadType): AuthorityLevel[];
  abstract isRTIEligible(complaint: Complaint): boolean;
  abstract formatComplaintId(district: string, sequence: number): string;
  abstract validateComplaint(complaint: Partial<Complaint>): ValidationResult;
  
  // Common functionality
  protected getBusinessHours(): BusinessHours {
    return {
      start: 9,
      end: 17,
      workingDays: [1, 2, 3, 4, 5], // Monday to Friday
      holidays: []
    };
  }
}

// India-specific implementation
class IndiaAdapter extends CountryAdapter {
  getCountryCode(): string {
    return 'IN';
  }
  
  calculateSLA(severity: Severity, roadType: RoadType): number {
    const slaMatrix: Record<Severity, Record<RoadType, number>> = {
      [Severity.CRITICAL]: {
        [RoadType.NATIONAL_HIGHWAY]: 4,
        [RoadType.STATE_HIGHWAY]: 8,
        [RoadType.DISTRICT_ROAD]: 12,
        [RoadType.VILLAGE_ROAD]: 24,
        [RoadType.CITY_ROAD]: 8
      },
      // ... more severity levels
    };
    
    return slaMatrix[severity][roadType];
  }
  
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
      default:
        return [
          { name: 'Local Authority', level: 1 },
          { name: 'Municipal Corporation', level: 2 }
        ];
    }
  }
  
  isRTIEligible(complaint: Complaint): boolean {
    const daysSinceCreation = Math.floor(
      (Date.now() - complaint.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    // RTI eligible after 60 days in India
    return daysSinceCreation >= 60 && 
           complaint.status !== ComplaintStatus.RESOLVED;
  }
}

// US-specific implementation
class USAdapter extends CountryAdapter {
  getCountryCode(): string {
    return 'US';
  }
  
  calculateSLA(severity: Severity, roadType: RoadType): number {
    // US-specific SLA calculations
    const slaMatrix: Record<Severity, Record<RoadType, number>> = {
      [Severity.CRITICAL]: {
        [RoadType.NATIONAL_HIGHWAY]: 2, // Faster response in US
        [RoadType.STATE_HIGHWAY]: 4,
        [RoadType.DISTRICT_ROAD]: 8,
        [RoadType.VILLAGE_ROAD]: 16,
        [RoadType.CITY_ROAD]: 4
      }
    };
    
    return slaMatrix[severity][roadType];
  }
  
  isRTIEligible(complaint: Complaint): boolean {
    // FOIA (Freedom of Information Act) - generally always eligible
    return true;
  }
}
```

### Authentication Adapter Pattern
```typescript
// Authentication adapter interface
interface AuthAdapter {
  authenticate(credentials: AuthCredentials): Promise<AuthResult>;
  validateToken(token: string): Promise<TokenValidationResult>;
  refreshToken(refreshToken: string): Promise<AuthResult>;
  logout(token: string): Promise<void>;
}

// OTP-based authentication
class OTPAuthAdapter implements AuthAdapter {
  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const { phone, otp } = credentials;
    
    // Validate OTP
    const isValid = await this.validateOTP(phone, otp);
    if (!isValid) {
      throw new Error('Invalid OTP');
    }
    
    // Generate JWT token
    const user = await this.getUserByPhone(phone);
    const token = this.generateJWT(user);
    
    return {
      success: true,
      token,
      refreshToken: this.generateRefreshToken(user),
      user
    };
  }
  
  async validateToken(token: string): Promise<TokenValidationResult> {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!);
      return { valid: true, payload };
    } catch (error) {
      return { valid: false, error: (error as Error).message };
    }
  }
}

// OAuth adapter for government SSO
class GovSSOAuthAdapter implements AuthAdapter {
  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const { authorizationCode } = credentials;
    
    // Exchange authorization code for access token
    const tokenResponse = await this.exchangeCodeForToken(authorizationCode);
    
    // Get user info from government SSO
    const userInfo = await this.getUserInfo(tokenResponse.accessToken);
    
    // Create or update user in local database
    const user = await this.syncUser(userInfo);
    
    return {
      success: true,
      token: this.generateJWT(user),
      refreshToken: tokenResponse.refreshToken,
      user
    };
  }
}
```

## Platform Adapters

### Platform Detection & Adaptation
```typescript
// Platform adapter for different runtime environments
interface PlatformAdapter {
  getStorageAdapter(): StorageAdapter;
  getNetworkAdapter(): NetworkAdapter;
  getNotificationAdapter(): NotificationAdapter;
  getCameraAdapter(): CameraAdapter;
  getLocationAdapter(): LocationAdapter;
}

// Web platform adapter
class WebPlatformAdapter implements PlatformAdapter {
  getStorageAdapter(): StorageAdapter {
    return new LocalStorageAdapter();
  }
  
  getNetworkAdapter(): NetworkAdapter {
    return new FetchNetworkAdapter();
  }
  
  getNotificationAdapter(): NotificationAdapter {
    return new WebNotificationAdapter();
  }
  
  getCameraAdapter(): CameraAdapter {
    return new WebRTCCameraAdapter();
  }
  
  getLocationAdapter(): LocationAdapter {
    return new GeolocationAPIAdapter();
  }
}

// React Native platform adapter
class ReactNativePlatformAdapter implements PlatformAdapter {
  getStorageAdapter(): StorageAdapter {
    return new AsyncStorageAdapter();
  }
  
  getNetworkAdapter(): NetworkAdapter {
    return new ReactNativeNetworkAdapter();
  }
  
  getNotificationAdapter(): NotificationAdapter {
    return new FCMNotificationAdapter();
  }
  
  getCameraAdapter(): CameraAdapter {
    return new ReactNativeCameraAdapter();
  }
  
  getLocationAdapter(): LocationAdapter {
    return new ReactNativeLocationAdapter();
  }
}

// Node.js platform adapter
class NodePlatformAdapter implements PlatformAdapter {
  getStorageAdapter(): StorageAdapter {
    return new FileSystemStorageAdapter();
  }
  
  getNetworkAdapter(): NetworkAdapter {
    return new NodeFetchAdapter();
  }
  
  getNotificationAdapter(): NotificationAdapter {
    return new ServerNotificationAdapter();
  }
  
  getCameraAdapter(): CameraAdapter {
    throw new Error('Camera not available in Node.js environment');
  }
  
  getLocationAdapter(): LocationAdapter {
    throw new Error('Location services not available in Node.js environment');
  }
}

// Platform adapter factory
class PlatformAdapterFactory {
  static create(): PlatformAdapter {
    if (typeof window !== 'undefined') {
      return new WebPlatformAdapter();
    } else if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
      return new ReactNativePlatformAdapter();
    } else if (typeof process !== 'undefined' && process.versions?.node) {
      return new NodePlatformAdapter();
    } else {
      throw new Error('Unknown platform environment');
    }
  }
}
```

## Adapter Configuration & Registration

### Centralized Adapter Management
```typescript
// Global adapter registry
class GlobalAdapterRegistry {
  private static instance: GlobalAdapterRegistry;
  
  private storageRegistry = new AdapterRegistry<StorageAdapter>();
  private messagingRegistry = new AdapterRegistry<MessagingAdapter>();
  private countryRegistry = new AdapterRegistry<CountryAdapter>();
  private authRegistry = new AdapterRegistry<AuthAdapter>();
  
  static getInstance(): GlobalAdapterRegistry {
    if (!GlobalAdapterRegistry.instance) {
      GlobalAdapterRegistry.instance = new GlobalAdapterRegistry();
    }
    return GlobalAdapterRegistry.instance;
  }
  
  // Storage adapters
  registerStorageAdapter(name: string, adapter: StorageAdapter): void {
    this.storageRegistry.register(name, adapter);
  }
  
  getStorageAdapter(name?: string): StorageAdapter {
    return this.storageRegistry.get(name);
  }
  
  // Messaging adapters
  registerMessagingAdapter(name: string, adapter: MessagingAdapter): void {
    this.messagingRegistry.register(name, adapter);
  }
  
  getMessagingAdapter(name?: string): MessagingAdapter {
    return this.messagingRegistry.get(name);
  }
  
  // Country adapters
  registerCountryAdapter(countryCode: string, adapter: CountryAdapter): void {
    this.countryRegistry.register(countryCode, adapter);
  }
  
  getCountryAdapter(countryCode?: string): CountryAdapter {
    return this.countryRegistry.get(countryCode);
  }
  
  // Authentication adapters
  registerAuthAdapter(name: string, adapter: AuthAdapter): void {
    this.authRegistry.register(name, adapter);
  }
  
  getAuthAdapter(name?: string): AuthAdapter {
    return this.authRegistry.get(name);
  }
}

// Adapter initialization
class AdapterInitializer {
  static async initialize(): Promise<void> {
    const registry = GlobalAdapterRegistry.getInstance();
    
    // Initialize storage adapters
    if (Platform.isWeb()) {
      registry.registerStorageAdapter('default', new LocalStorageAdapter());
    } else if (Platform.isMobile()) {
      registry.registerStorageAdapter('default', new SQLiteStorageAdapter());
    } else {
      registry.registerStorageAdapter('default', new PostgreSQLStorageAdapter(dbConfig));
    }
    
    // Initialize messaging adapters
    if (isUpstashKafkaConfigured()) {
      registry.registerMessagingAdapter('default', new UpstashMessagingAdapter(upstashConfig));
    } else {
      registry.registerMessagingAdapter('default', new KafkaMessagingAdapter(kafkaConfig));
    }
    
    // Initialize country adapters
    registry.registerCountryAdapter('IN', new IndiaAdapter());
    registry.registerCountryAdapter('US', new USAdapter());
    registry.registerCountryAdapter('default', new IndiaAdapter()); // Default to India
    
    // Initialize auth adapters
    registry.registerAuthAdapter('otp', new OTPAuthAdapter());
    registry.registerAuthAdapter('gov-sso', new GovSSOAuthAdapter());
    registry.registerAuthAdapter('default', new OTPAuthAdapter());
    
    // Connect all adapters
    await registry.getStorageAdapter().connect();
    await registry.getMessagingAdapter().connect();
  }
}
```

## Usage Examples

### Using Adapters in Services
```typescript
// Service using multiple adapters
class ComplaintService {
  private storage: StorageAdapter;
  private messaging: MessagingAdapter;
  private countryAdapter: CountryAdapter;
  
  constructor() {
    const registry = GlobalAdapterRegistry.getInstance();
    this.storage = registry.getStorageAdapter();
    this.messaging = registry.getMessagingAdapter();
    this.countryAdapter = registry.getCountryAdapter(process.env.COUNTRY_CODE);
  }
  
  async submitComplaint(complaintData: ComplaintData): Promise<string> {
    // Validate using country-specific rules
    const validation = this.countryAdapter.validateComplaint(complaintData);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }
    
    // Generate country-specific complaint ID
    const complaintId = this.countryAdapter.formatComplaintId(
      complaintData.district,
      await this.getNextSequence()
    );
    
    // Store complaint
    await this.storage.set(`complaint:${complaintId}`, {
      ...complaintData,
      id: complaintId,
      createdAt: new Date().toISOString()
    });
    
    // Publish event
    await this.messaging.publish('complaint.submitted', {
      complaintId,
      district: complaintData.district,
      zone: complaintData.zone
    });
    
    return complaintId;
  }
  
  async calculateSLADeadline(complaintId: string): Promise<Date> {
    const complaint = await this.storage.get<Complaint>(`complaint:${complaintId}`);
    if (!complaint) {
      throw new Error('Complaint not found');
    }
    
    const slaHours = this.countryAdapter.calculateSLA(complaint.severity, complaint.roadType);
    const deadline = new Date(complaint.createdAt);
    deadline.setHours(deadline.getHours() + slaHours);
    
    return deadline;
  }
}
```

### Dynamic Adapter Switching
```typescript
// Service that can switch adapters at runtime
class ConfigurableService {
  private currentStorageAdapter?: StorageAdapter;
  
  async switchStorageAdapter(adapterName: string): Promise<void> {
    // Disconnect current adapter
    if (this.currentStorageAdapter) {
      await this.currentStorageAdapter.disconnect();
    }
    
    // Switch to new adapter
    const registry = GlobalAdapterRegistry.getInstance();
    this.currentStorageAdapter = registry.getStorageAdapter(adapterName);
    await this.currentStorageAdapter.connect();
    
    console.log(`Switched to storage adapter: ${adapterName}`);
  }
  
  async migrateData(fromAdapter: string, toAdapter: string): Promise<void> {
    const registry = GlobalAdapterRegistry.getInstance();
    const source = registry.getStorageAdapter(fromAdapter);
    const target = registry.getStorageAdapter(toAdapter);
    
    // Implement data migration logic
    const keys = await source.query({ type: 'all' });
    
    for (const key of keys) {
      const data = await source.get(key);
      if (data) {
        await target.set(key, data);
      }
    }
    
    console.log(`Migrated data from ${fromAdapter} to ${toAdapter}`);
  }
}
```

## Benefits of Adapter Pattern

### Flexibility
- Easy to switch between different implementations
- Support for multiple providers simultaneously
- Runtime configuration changes

### Testability
- Mock adapters for unit testing
- Isolated testing of business logic
- Easy to create test doubles

### Maintainability
- Clear separation of concerns
- Consistent interfaces across implementations
- Easy to add new providers

### Scalability
- Can optimize different adapters for different use cases
- Load balancing across multiple providers
- Graceful degradation when providers fail