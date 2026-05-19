# Redis Provider Service

## Overview
Redis-based caching and idempotency provider that supports both local Redis and Upstash Redis Cloud. Provides high-performance caching, session management, and duplicate request prevention across the RoadWatch system.

## Architecture
- **Runtime**: Node.js with TypeScript
- **Redis Client**: ioredis for local Redis, @upstash/redis for cloud
- **Configuration**: Environment-based provider selection
- **Features**: Caching, idempotency keys, session storage
- **Deployment**: Containerized with Redis cluster support

## Key Components

### Redis Client Factory
```typescript
// Client factory with automatic provider selection
class RedisClientFactory {
  static create(): RedisClient {
    if (isUpstashRedisConfigured()) {
      return new UpstashRedisClient(getUpstashRedisConfig());
    } else {
      return new LocalRedisClient(getLocalRedisConfig());
    }
  }
}

// Local Redis client (ioredis)
class LocalRedisClient implements RedisClient {
  private client: IORedis;
  
  constructor(config: LocalRedisConfig) {
    this.client = new IORedis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.database,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    });
  }
  
  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }
  
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }
}

// Upstash Redis client
class UpstashRedisClient implements RedisClient {
  private client: Redis;
  
  constructor(config: UpstashRedisConfig) {
    this.client = new Redis({
      url: config.restUrl,
      token: config.restToken
    });
  }
  
  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }
  
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }
}
```

### Idempotency Management
```typescript
// Idempotency key management for duplicate request prevention
interface ClaimIdempotencyResult {
  success: boolean;
  alreadyProcessed: boolean;
  existingResult?: any;
}

class IdempotencyManager {
  constructor(private redis: RedisClient) {}
  
  async claimIdempotencyKey(
    key: string, 
    ttlSeconds: number = 3600
  ): Promise<ClaimIdempotencyResult> {
    const lockKey = `idempotency:${key}`;
    const resultKey = `idempotency:result:${key}`;
    
    // Try to acquire lock
    const acquired = await this.redis.set(
      lockKey, 
      'processing', 
      ttlSeconds, 
      'NX' // Only set if not exists
    );
    
    if (!acquired) {
      // Key already exists, check if result is available
      const existingResult = await this.redis.get(resultKey);
      
      return {
        success: false,
        alreadyProcessed: !!existingResult,
        existingResult: existingResult ? JSON.parse(existingResult) : undefined
      };
    }
    
    return { success: true, alreadyProcessed: false };
  }
  
  async storeIdempotencyResult(
    key: string, 
    result: any, 
    ttlSeconds: number = 3600
  ): Promise<void> {
    const resultKey = `idempotency:result:${key}`;
    await this.redis.set(resultKey, JSON.stringify(result), ttlSeconds);
  }
  
  async releaseIdempotencyKey(key: string): Promise<void> {
    const lockKey = `idempotency:${key}`;
    await this.redis.del(lockKey);
  }
}
```

### Caching Service
```typescript
// High-level caching service with typed operations
class CacheService {
  constructor(private redis: RedisClient) {}
  
  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }
  
  async set<T>(
    key: string, 
    value: T, 
    ttlSeconds: number = 300
  ): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), ttlSeconds);
  }
  
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds: number = 300
  ): Promise<T> {
    let value = await this.get<T>(key);
    
    if (value === null) {
      value = await factory();
      await this.set(key, value, ttlSeconds);
    }
    
    return value;
  }
  
  async invalidate(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
  
  // Cache with tags for group invalidation
  async setWithTags<T>(
    key: string,
    value: T,
    tags: string[],
    ttlSeconds: number = 300
  ): Promise<void> {
    await this.set(key, value, ttlSeconds);
    
    // Store tag associations
    for (const tag of tags) {
      await this.redis.sadd(`tag:${tag}`, key);
      await this.redis.expire(`tag:${tag}`, ttlSeconds);
    }
  }
  
  async invalidateByTag(tag: string): Promise<void> {
    const keys = await this.redis.smembers(`tag:${tag}`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
      await this.redis.del(`tag:${tag}`);
    }
  }
}
```

## Configuration

### Environment-Based Setup
```typescript
interface LocalRedisConfig {
  host: string;
  port: number;
  password?: string;
  database: number;
  maxRetries: number;
}

interface UpstashRedisConfig {
  restUrl: string;
  restToken: string;
}

function getLocalRedisConfig(): LocalRedisConfig {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    database: parseInt(process.env.REDIS_DB || '0'),
    maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || '3')
  };
}

function getUpstashRedisConfig(): UpstashRedisConfig {
  return {
    restUrl: process.env.UPSTASH_REDIS_REST_URL!,
    restToken: process.env.UPSTASH_REDIS_REST_TOKEN!
  };
}

function isUpstashRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
```

## Use Cases

### API Response Caching
```typescript
// Cache expensive API responses
class ComplaintService {
  constructor(
    private cache: CacheService,
    private database: DatabaseService
  ) {}
  
  async getComplaintsByDistrict(district: string): Promise<Complaint[]> {
    const cacheKey = `complaints:district:${district}`;
    
    return await this.cache.getOrSet(
      cacheKey,
      () => this.database.getComplaintsByDistrict(district),
      300 // 5 minutes
    );
  }
  
  async updateComplaintStatus(id: string, status: ComplaintStatus): Promise<void> {
    await this.database.updateComplaintStatus(id, status);
    
    // Invalidate related caches
    const complaint = await this.database.getComplaint(id);
    await this.cache.invalidate(`complaints:district:${complaint.district}`);
    await this.cache.invalidate(`complaint:${id}`);
  }
}
```

### Session Management
```typescript
// User session storage
class SessionService {
  constructor(private cache: CacheService) {}
  
  async createSession(userId: string, sessionData: SessionData): Promise<string> {
    const sessionId = generateSessionId();
    const sessionKey = `session:${sessionId}`;
    
    await this.cache.set(sessionKey, {
      userId,
      ...sessionData,
      createdAt: new Date().toISOString()
    }, 86400); // 24 hours
    
    return sessionId;
  }
  
  async getSession(sessionId: string): Promise<SessionData | null> {
    const sessionKey = `session:${sessionId}`;
    return await this.cache.get<SessionData>(sessionKey);
  }
  
  async refreshSession(sessionId: string): Promise<void> {
    const sessionKey = `session:${sessionId}`;
    const session = await this.cache.get<SessionData>(sessionKey);
    
    if (session) {
      await this.cache.set(sessionKey, session, 86400);
    }
  }
  
  async destroySession(sessionId: string): Promise<void> {
    const sessionKey = `session:${sessionId}`;
    await this.cache.del(sessionKey);
  }
}
```

### Rate Limiting
```typescript
// Rate limiting with Redis
class RateLimiter {
  constructor(private redis: RedisClient) {}
  
  async checkRateLimit(
    identifier: string,
    windowSeconds: number,
    maxRequests: number
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const key = `rate_limit:${identifier}`;
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    
    // Use Redis sorted set for sliding window
    await this.redis.zremrangebyscore(key, 0, windowStart);
    
    const currentCount = await this.redis.zcard(key);
    
    if (currentCount >= maxRequests) {
      const oldestRequest = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
      const resetTime = oldestRequest.length > 0 ? 
        parseInt(oldestRequest[1]) + (windowSeconds * 1000) : 
        now + (windowSeconds * 1000);
      
      return {
        allowed: false,
        remaining: 0,
        resetTime
      };
    }
    
    // Add current request
    await this.redis.zadd(key, now, `${now}-${Math.random()}`);
    await this.redis.expire(key, windowSeconds);
    
    return {
      allowed: true,
      remaining: maxRequests - currentCount - 1,
      resetTime: now + (windowSeconds * 1000)
    };
  }
}
```

## Performance Optimization

### Connection Pooling
```typescript
// Redis connection pool management
class RedisConnectionPool {
  private pool: IORedis[] = [];
  private currentIndex = 0;
  
  constructor(
    private config: LocalRedisConfig,
    private poolSize: number = 10
  ) {
    this.initializePool();
  }
  
  private initializePool(): void {
    for (let i = 0; i < this.poolSize; i++) {
      const client = new IORedis(this.config);
      this.pool.push(client);
    }
  }
  
  getConnection(): IORedis {
    const connection = this.pool[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.poolSize;
    return connection;
  }
  
  async closeAll(): Promise<void> {
    await Promise.all(this.pool.map(client => client.quit()));
  }
}
```

### Batch Operations
```typescript
// Efficient batch operations
class BatchCacheService {
  constructor(private redis: RedisClient) {}
  
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    const values = await this.redis.mget(...keys);
    return values.map(value => value ? JSON.parse(value) : null);
  }
  
  async mset<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    const pipeline = this.redis.pipeline();
    
    for (const entry of entries) {
      if (entry.ttl) {
        pipeline.setex(entry.key, entry.ttl, JSON.stringify(entry.value));
      } else {
        pipeline.set(entry.key, JSON.stringify(entry.value));
      }
    }
    
    await pipeline.exec();
  }
}
```

## Monitoring & Health Checks

### Health Check Implementation
```typescript
class RedisHealthCheck {
  constructor(private redis: RedisClient) {}
  
  async checkHealth(): Promise<HealthStatus> {
    try {
      const start = Date.now();
      await this.redis.ping();
      const latency = Date.now() - start;
      
      return {
        healthy: true,
        latency,
        details: {
          provider: isUpstashRedisConfigured() ? 'upstash' : 'local',
          latencyMs: latency
        }
      };
    } catch (error) {
      return {
        healthy: false,
        error: (error as Error).message,
        details: {
          provider: isUpstashRedisConfigured() ? 'upstash' : 'local'
        }
      };
    }
  }
}
```

### Metrics Collection
```typescript
class RedisMetrics {
  private hitCount = 0;
  private missCount = 0;
  
  recordHit(): void {
    this.hitCount++;
  }
  
  recordMiss(): void {
    this.missCount++;
  }
  
  getHitRatio(): number {
    const total = this.hitCount + this.missCount;
    return total > 0 ? this.hitCount / total : 0;
  }
  
  getMetrics(): RedisMetricsData {
    return {
      hits: this.hitCount,
      misses: this.missCount,
      hitRatio: this.getHitRatio(),
      totalOperations: this.hitCount + this.missCount
    };
  }
}
```

## Error Handling & Resilience

### Circuit Breaker Pattern
```typescript
class RedisCircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private redis: RedisClient,
    private failureThreshold = 5,
    private timeoutMs = 60000
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Redis circuit breaker is OPEN');
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

## Security Considerations
- Redis AUTH password protection
- TLS encryption for data in transit
- Network isolation and firewall rules
- Regular security updates
- Access control and user management
- Audit logging for sensitive operations

## Deployment
- Docker containerization with Redis official image
- Kubernetes deployment with persistent volumes
- Redis Cluster for high availability
- Backup and restore procedures
- Monitoring with Redis metrics exporters