# Configuration Services

## Overview
Centralized configuration management system that handles environment-specific settings, feature flags, and runtime configuration across all RoadWatch services.

## Configuration Architecture

### Configuration Hierarchy
```
Global Config (config/)
├── base.json (default values)
├── development.json (dev overrides)
├── staging.json (staging overrides)
└── production.json (prod overrides)

Service Config (.env files)
├── apps/gateway-api/.env
├── apps/authority-portal/.env
├── apps/mobile-host/.env
└── services/fabric-anchor-consumer/.env

Runtime Config (Environment Variables)
├── DATABASE_URL
├── POSTGRES_HOST
├── POSTGRES_PORT
├── KAFKA_BROKERS
├── FABRIC_PEER_ENDPOINT
└── JWT_SECRET
```

### Configuration Loading
```typescript
// Configuration loader with environment merging
class ConfigurationManager {
  private config: AppConfig;
  
  constructor(environment: string = process.env.NODE_ENV || 'development') {
    this.config = this.loadConfiguration(environment);
  }
  
  private loadConfiguration(environment: string): AppConfig {
    // Load base configuration
    const baseConfig = this.loadJsonConfig('config/base.json');
    
    // Load environment-specific overrides
    const envConfig = this.loadJsonConfig(`config/${environment}.json`);
    
    // Merge with environment variables
    const envVarConfig = this.loadEnvironmentVariables();
    
    // Merge configurations (env vars take precedence)
    return this.mergeConfigs(baseConfig, envConfig, envVarConfig);
  }
  
  private loadJsonConfig(path: string): Partial<AppConfig> {
    try {
      const content = fs.readFileSync(path, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Config file not found: ${path}`);
      return {};
    }
  }
  
  private loadEnvironmentVariables(): Partial<AppConfig> {
    return {
      // PgBouncer-backed Postgres connection settings (preferred)
      database: {
        connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:6432/roadwatch'
      },
      kafka: {
        brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
        clientId: process.env.KAFKA_CLIENT_ID || 'roadwatch-client',
        ssl: process.env.KAFKA_SSL === 'true'
      },
      fabric: {
        peerEndpoint: process.env.FABRIC_PEER_ENDPOINT || 'peer0.roadwatch.com:7051',
        mspId: process.env.FABRIC_MSP_ID || 'RoadWatchMSP',
        channelName: process.env.FABRIC_CHANNEL || 'roadwatch-india',
        chaincodeName: process.env.FABRIC_CHAINCODE || 'complaint-anchor'
      },
      auth: {
        jwtSecret: process.env.JWT_SECRET!,
        otpExpiry: parseInt(process.env.OTP_EXPIRY || '300'),
        refreshTokenExpiry: parseInt(process.env.REFRESH_TOKEN_EXPIRY || '604800')
      },
      redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || '3')
      }
    };
  }
  
  private mergeConfigs(...configs: Partial<AppConfig>[]): AppConfig {
    return configs.reduce((merged, config) => {
      return this.deepMerge(merged, config);
    }, {} as AppConfig);
  }
  
  // Deep merge utility
  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
  
  // Configuration access methods
  get<T>(path: string): T {
    return this.getNestedValue(this.config, path);
  }
  
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}
```

## Configuration Schema

### Application Configuration
```typescript
interface AppConfig {
  app: {
    name: string;
    version: string;
    port: number;
    environment: 'development' | 'staging' | 'production';
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
  
  database: {
    url: string;
    maxConnections: number;
    ssl: boolean;
    timeout: number;
    retryAttempts: number;
  };
  
  kafka: {
    brokers: string[];
    clientId: string;
    ssl: boolean;
    sasl?: {
      mechanism: string;
      username: string;
      password: string;
    };
  };
  
  fabric: {
    peerEndpoint: string;
    peerHostAlias?: string;
    mspId: string;
    channelName: string;
    chaincodeName: string;
    tlsCertPath: string;
    identityCertPath: string;
    identityKeyPath: string;
  };
  
  auth: {
    jwtSecret: string;
    otpExpiry: number;
    refreshTokenExpiry: number;
    maxLoginAttempts: number;
    lockoutDuration: number;
  };
  
  redis: {
    url: string;
    maxRetries: number;
    retryDelay: number;
    keyPrefix: string;
  };
  
  notifications: {
    fcm: {
      serverKey: string;
      projectId: string;
    };
    sms: {
      provider: 'twilio' | 'aws-sns';
      apiKey: string;
      apiSecret: string;
    };
    email: {
      provider: 'sendgrid' | 'ses';
      apiKey: string;
      fromAddress: string;
    };
  };
  
  features: {
    enableBlockchainAnchoring: boolean;
    enableRealTimeUpdates: boolean;
    enableAnalytics: boolean;
    enableOfflineMode: boolean;
    maxComplaintAttachments: number;
    maxAttachmentSize: number;
  };
  
  security: {
    corsOrigins: string[];
    rateLimiting: {
      windowMs: number;
      maxRequests: number;
    };
    encryption: {
      algorithm: string;
      keyLength: number;
    };
  };
  
  monitoring: {
    enableMetrics: boolean;
    metricsPort: number;
    healthCheckInterval: number;
    logRetentionDays: number;
  };
}
```

### Configuration Files

#### Base Configuration (`config/base.json`)
```json
{
  "app": {
    "name": "RoadWatch",
    "version": "1.0.0",
    "port": 3000,
    "logLevel": "info"
  },
  "database": {
    "maxConnections": 10,
    "ssl": false,
    "timeout": 30000,
    "retryAttempts": 3
  },
  "kafka": {
    "clientId": "roadwatch-client",
    "ssl": false
  },
  "fabric": {
    "channelName": "roadwatch-india",
    "chaincodeName": "complaint-anchor"
  },
  "auth": {
    "otpExpiry": 300,
    "refreshTokenExpiry": 604800,
    "maxLoginAttempts": 5,
    "lockoutDuration": 900
  },
  "redis": {
    "maxRetries": 3,
    "retryDelay": 1000,
    "keyPrefix": "roadwatch:"
  },
  "features": {
    "enableBlockchainAnchoring": true,
    "enableRealTimeUpdates": true,
    "enableAnalytics": true,
    "enableOfflineMode": true,
    "maxComplaintAttachments": 5,
    "maxAttachmentSize": 15728640
  },
  "security": {
    "corsOrigins": ["*"],
    "rateLimiting": {
      "windowMs": 900000,
      "maxRequests": 100
    },
    "encryption": {
      "algorithm": "aes-256-gcm",
      "keyLength": 32
    }
  },
  "monitoring": {
    "enableMetrics": true,
    "metricsPort": 9090,
    "healthCheckInterval": 30000,
    "logRetentionDays": 30
  }
}
```

#### Development Configuration (`config/development.json`)
```json
{
  "app": {
    "environment": "development",
    "logLevel": "debug"
  },
  "database": {
    "ssl": false
  },
  "security": {
    "corsOrigins": ["http://localhost:3001", "http://localhost:19006"]
  },
  "features": {
    "enableBlockchainAnchoring": false
  }
}
```

#### Production Configuration (`config/production.json`)
```json
{
  "app": {
    "environment": "production",
    "logLevel": "warn"
  },
  "database": {
    "ssl": true,
    "maxConnections": 50
  },
  "kafka": {
    "ssl": true
  },
  "security": {
    "corsOrigins": ["https://roadwatch.gov.in", "https://authority.roadwatch.gov.in"],
    "rateLimiting": {
      "windowMs": 900000,
      "maxRequests": 1000
    }
  },
  "monitoring": {
    "logRetentionDays": 90
  }
}
```

## Feature Flags

### Feature Flag Management
```typescript
// Feature flag service
class FeatureFlagService {
  private flags: Map<string, FeatureFlag> = new Map();
  
  constructor(private config: AppConfig) {
    this.initializeFlags();
  }
  
  private initializeFlags(): void {
    // Load from configuration
    Object.entries(this.config.features).forEach(([key, value]) => {
      this.flags.set(key, {
        name: key,
        enabled: value as boolean,
        rolloutPercentage: 100,
        conditions: []
      });
    });
    
    // Load dynamic flags from database/remote service
    this.loadDynamicFlags();
  }
  
  isEnabled(flagName: string, context?: FeatureFlagContext): boolean {
    const flag = this.flags.get(flagName);
    if (!flag) {
      return false;
    }
    
    // Check basic enabled state
    if (!flag.enabled) {
      return false;
    }
    
    // Check rollout percentage
    if (flag.rolloutPercentage < 100) {
      const hash = this.hashContext(context);
      if (hash % 100 >= flag.rolloutPercentage) {
        return false;
      }
    }
    
    // Check conditions
    return this.evaluateConditions(flag.conditions, context);
  }
  
  private evaluateConditions(conditions: FeatureFlagCondition[], context?: FeatureFlagContext): boolean {
    if (!conditions.length) return true;
    
    return conditions.every(condition => {
      switch (condition.type) {
        case 'user_role':
          return context?.userRole === condition.value;
        case 'district':
          return context?.district === condition.value;
        case 'app_version':
          return this.compareVersions(context?.appVersion, condition.operator, condition.value);
        default:
          return true;
      }
    });
  }
}

interface FeatureFlag {
  name: string;
  enabled: boolean;
  rolloutPercentage: number;
  conditions: FeatureFlagCondition[];
}

interface FeatureFlagCondition {
  type: 'user_role' | 'district' | 'app_version';
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte';
  value: string;
}

interface FeatureFlagContext {
  userId?: string;
  userRole?: string;
  district?: string;
  appVersion?: string;
}
```

### Usage in Services
```typescript
// Using feature flags in services
class ComplaintService {
  constructor(
    private config: AppConfig,
    private featureFlags: FeatureFlagService
  ) {}
  
  async submitComplaint(data: ComplaintData, context: FeatureFlagContext): Promise<Complaint> {
    const complaint = await this.createComplaint(data);
    
    // Conditional blockchain anchoring
    if (this.featureFlags.isEnabled('enableBlockchainAnchoring', context)) {
      await this.queueForBlockchainAnchoring(complaint);
    }
    
    // Conditional real-time updates
    if (this.featureFlags.isEnabled('enableRealTimeUpdates', context)) {
      await this.broadcastRealTimeUpdate(complaint);
    }
    
    // Conditional analytics
    if (this.featureFlags.isEnabled('enableAnalytics', context)) {
      await this.recordAnalyticsEvent('complaint_submitted', complaint);
    }
    
    return complaint;
  }
}
```

## Environment-Specific Configuration

### Docker Configuration
```yaml
# docker-compose.yml
version: '3.8'
services:
  gateway-api:
    build: ./apps/gateway-api
    environment:
      - NODE_ENV=development
      # DATABASE_URL should target the PgBouncer-backed pooled endpoint.
      - DATABASE_URL=postgresql://postgres:postgres@pgbouncer:6432/roadwatch
      - POSTGRES_HOST=postgres
      - POSTGRES_PORT=5432
      - KAFKA_BROKERS=kafka:9092
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./config:/app/config:ro
    depends_on:
      - postgres
      - kafka
      - redis

  postgres:
    image: postgres:16
    environment:
      - POSTGRES_DB=roadwatch
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data

  kafka:
    image: confluentinc/cp-kafka:latest
    environment:
      - KAFKA_ZOOKEEPER_CONNECT=zookeeper:2181
      - KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092
    depends_on:
      - zookeeper

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
```

### Kubernetes Configuration
```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: roadwatch-config
data:
  NODE_ENV: "production"
  KAFKA_BROKERS: "kafka-cluster:9092"
  FABRIC_CHANNEL: "roadwatch-india"
  LOG_LEVEL: "info"

---
apiVersion: v1
kind: Secret
metadata:
  name: roadwatch-secrets
type: Opaque
stringData:
  # Postgres connection parameters (prefer PgBouncer-backed pooled endpoint)
  DATABASE_URL: "postgresql://postgres:postgres@postgres:5432/roadwatch"
  JWT_SECRET: "your-jwt-secret"
  FABRIC_IDENTITY_KEY: |
    -----BEGIN PRIVATE KEY-----
    ...
    -----END PRIVATE KEY-----

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: gateway-api
  template:
    metadata:
      labels:
        app: gateway-api
    spec:
      containers:
      - name: gateway-api
        image: roadwatch/gateway-api:latest
        envFrom:
        - configMapRef:
            name: roadwatch-config
        - secretRef:
            name: roadwatch-secrets
        volumeMounts:
        - name: config-volume
          mountPath: /app/config
          readOnly: true
      volumes:
      - name: config-volume
        configMap:
          name: roadwatch-config-files
```

## Configuration Validation

### Schema Validation
```typescript
// Configuration validation using Zod
import { z } from 'zod';

const AppConfigSchema = z.object({
  app: z.object({
    name: z.string(),
    version: z.string(),
    port: z.number().min(1).max(65535),
    environment: z.enum(['development', 'staging', 'production']),
    logLevel: z.enum(['debug', 'info', 'warn', 'error'])
  }),
  
  database: z.object({
    url: z.string().url(),
    maxConnections: z.number().min(1).max(100),
    ssl: z.boolean(),
    timeout: z.number().min(1000),
    retryAttempts: z.number().min(0).max(10)
  }),
  
  kafka: z.object({
    brokers: z.array(z.string()).min(1),
    clientId: z.string().min(1),
    ssl: z.boolean(),
    sasl: z.object({
      mechanism: z.string(),
      username: z.string(),
      password: z.string()
    }).optional()
  }),
  
  auth: z.object({
    jwtSecret: z.string().min(32),
    otpExpiry: z.number().min(60).max(3600),
    refreshTokenExpiry: z.number().min(3600),
    maxLoginAttempts: z.number().min(1).max(10),
    lockoutDuration: z.number().min(60)
  })
});

class ConfigValidator {
  static validate(config: unknown): AppConfig {
    try {
      return AppConfigSchema.parse(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        );
        throw new Error(`Configuration validation failed:\n${errorMessages.join('\n')}`);
      }
      throw error;
    }
  }
  
  static validateRequired(): void {
    const required = [
      'DATABASE_URL',
      'POSTGRES_HOST',
      'JWT_SECRET',
      'FABRIC_PEER_ENDPOINT'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }
}
```

## Configuration Hot Reloading

### Dynamic Configuration Updates
```typescript
// Configuration hot reloading service
class ConfigurationHotReload {
  private watchers: fs.FSWatcher[] = [];
  private listeners: ConfigChangeListener[] = [];
  
  constructor(private configManager: ConfigurationManager) {}
  
  startWatching(configPaths: string[]): void {
    configPaths.forEach(path => {
      const watcher = fs.watch(path, (eventType, filename) => {
        if (eventType === 'change') {
          this.handleConfigChange(path);
        }
      });
      
      this.watchers.push(watcher);
    });
  }
  
  private async handleConfigChange(configPath: string): Promise<void> {
    try {
      // Reload configuration
      const newConfig = await this.configManager.reload();
      
      // Validate new configuration
      ConfigValidator.validate(newConfig);
      
      // Notify listeners
      for (const listener of this.listeners) {
        await listener.onConfigChange(newConfig);
      }
      
      console.log(`Configuration reloaded from ${configPath}`);
    } catch (error) {
      console.error(`Failed to reload configuration from ${configPath}:`, error);
    }
  }
  
  addListener(listener: ConfigChangeListener): void {
    this.listeners.push(listener);
  }
  
  stopWatching(): void {
    this.watchers.forEach(watcher => watcher.close());
    this.watchers = [];
  }
}

interface ConfigChangeListener {
  onConfigChange(newConfig: AppConfig): Promise<void>;
}

// Service that responds to config changes
class DatabaseService implements ConfigChangeListener {
  async onConfigChange(newConfig: AppConfig): Promise<void> {
    // Update connection pool settings
    await this.updateConnectionPool(newConfig.database);
  }
}
```

## Configuration Best Practices

### Security
- Store secrets in environment variables or secret management systems
- Never commit sensitive configuration to version control
- Use encryption for sensitive configuration values
- Implement proper access controls for configuration files

### Performance
- Cache configuration values to avoid repeated file reads
- Use lazy loading for expensive configuration operations
- Implement configuration validation at startup
- Monitor configuration reload performance

### Maintainability
- Use consistent naming conventions across all configuration
- Document all configuration options and their effects
- Implement configuration schema validation
- Provide sensible defaults for all optional settings