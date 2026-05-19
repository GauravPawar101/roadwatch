# Testing Infrastructure

## Overview
The RoadWatch system uses a comprehensive testing strategy with multiple frameworks and utilities to ensure reliability across all services.

## Testing Frameworks

### Unit Testing
- **Vitest** - Primary testing framework for TypeScript/JavaScript services
- **Jest** - Legacy testing for some components
- **Go Testing** - Native Go testing for Fabric chaincodes

### Integration Testing
- **Supertest** - API endpoint testing
- **Testcontainers** - Database and service integration tests
- **Kafka Test Utils** - Event streaming integration tests

### End-to-End Testing
- **Playwright** - Web application E2E testing
- **Detox** - React Native mobile app testing
- **Blockchain Test Network** - Hyperledger Fabric testing

## Test Utilities

### Mock Services
```typescript
// Mock Kafka producer for testing
export class MockKafkaProducer implements IKafkaProducer {
  private messages: Array<{ topic: string; message: any }> = [];
  
  async send(topic: string, message: any): Promise<void> {
    this.messages.push({ topic, message });
  }
  
  getMessages(): Array<{ topic: string; message: any }> {
    return this.messages;
  }
}

// Mock Redis client
export class MockRedisClient implements IRedisClient {
  private store = new Map<string, string>();
  
  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }
  
  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.store.set(key, value);
  }
}
```

### Test Data Factories
```typescript
// Complaint test data factory
export class ComplaintFactory {
  static create(overrides: Partial<Complaint> = {}): Complaint {
    return {
      id: faker.string.uuid(),
      title: faker.lorem.sentence(),
      description: faker.lorem.paragraph(),
      category: faker.helpers.arrayElement(['ROAD_DAMAGE', 'TRAFFIC_VIOLATION']),
      location: {
        latitude: faker.location.latitude(),
        longitude: faker.location.longitude(),
        address: faker.location.streetAddress()
      },
      status: 'SUBMITTED',
      priority: 'MEDIUM',
      submittedAt: new Date(),
      ...overrides
    };
  }
}

// Authority test data factory
export class AuthorityFactory {
  static create(overrides: Partial<Authority> = {}): Authority {
    return {
      id: faker.string.uuid(),
      name: faker.company.name(),
      type: faker.helpers.arrayElement(['MUNICIPAL', 'STATE', 'NATIONAL']),
      jurisdiction: faker.location.city(),
      contactInfo: {
        email: faker.internet.email(),
        phone: faker.phone.number()
      },
      ...overrides
    };
  }
}
```

### Database Test Utilities
```typescript
// Database test setup
export class DatabaseTestUtils {
  static async setupTestDatabase(): Promise<DataSource> {
    const dataSource = new DataSource({
      type: 'postgres',
      host: 'localhost',
      port: 5433, // Test database port
      username: 'test',
      password: 'test',
      database: 'roadwatch_test',
      entities: [Complaint, Authority, User],
      synchronize: true,
      dropSchema: true
    });
    
    await dataSource.initialize();
    return dataSource;
  }
  
  static async seedTestData(dataSource: DataSource): Promise<void> {
    const complaintRepo = dataSource.getRepository(Complaint);
    const authorityRepo = dataSource.getRepository(Authority);
    
    // Create test authorities
    const authorities = Array.from({ length: 5 }, () => 
      AuthorityFactory.create()
    );
    await authorityRepo.save(authorities);
    
    // Create test complaints
    const complaints = Array.from({ length: 20 }, () => 
      ComplaintFactory.create({ authorityId: authorities[0].id })
    );
    await complaintRepo.save(complaints);
  }
}
```

## Test Configuration

### Vitest Configuration
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.test.ts'
      ]
    }
  }
});
```

### Test Environment Setup
```typescript
// src/test/setup.ts
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { DatabaseTestUtils } from './utils/database';
import { RedisTestUtils } from './utils/redis';

let testDatabase: DataSource;
let testRedis: Redis;

beforeAll(async () => {
  // Setup test database
  testDatabase = await DatabaseTestUtils.setupTestDatabase();
  
  // Setup test Redis
  testRedis = await RedisTestUtils.setupTestRedis();
});

beforeEach(async () => {
  // Clean and seed test data
  await DatabaseTestUtils.seedTestData(testDatabase);
  await RedisTestUtils.clearTestData(testRedis);
});

afterAll(async () => {
  // Cleanup
  await testDatabase.destroy();
  await testRedis.disconnect();
});
```

## Testing Patterns

### Service Testing
```typescript
describe('ComplaintService', () => {
  let service: ComplaintService;
  let mockKafka: MockKafkaProducer;
  let mockRedis: MockRedisClient;
  
  beforeEach(() => {
    mockKafka = new MockKafkaProducer();
    mockRedis = new MockRedisClient();
    service = new ComplaintService(mockKafka, mockRedis);
  });
  
  it('should create complaint and publish event', async () => {
    const complaintData = ComplaintFactory.create();
    
    const result = await service.createComplaint(complaintData);
    
    expect(result.id).toBeDefined();
    expect(mockKafka.getMessages()).toHaveLength(1);
    expect(mockKafka.getMessages()[0].topic).toBe('complaint.created');
  });
});
```

### API Testing
```typescript
describe('Complaint API', () => {
  let app: Express;
  
  beforeEach(() => {
    app = createTestApp();
  });
  
  it('POST /complaints should create complaint', async () => {
    const complaintData = {
      title: 'Road damage',
      description: 'Pothole on main street',
      category: 'ROAD_DAMAGE',
      location: {
        latitude: 40.7128,
        longitude: -74.0060,
        address: '123 Main St'
      }
    };
    
    const response = await request(app)
      .post('/api/complaints')
      .send(complaintData)
      .expect(201);
    
    expect(response.body.id).toBeDefined();
    expect(response.body.status).toBe('SUBMITTED');
  });
});
```

### Blockchain Testing
```typescript
describe('Complaint Chaincode', () => {
  let contract: ComplaintContract;
  let ctx: TestContext;
  
  beforeEach(() => {
    ctx = new TestContext();
    contract = new ComplaintContract();
  });
  
  it('should create complaint on blockchain', async () => {
    const complaint = ComplaintFactory.create();
    
    await contract.createComplaint(ctx, JSON.stringify(complaint));
    
    const stored = await contract.getComplaint(ctx, complaint.id);
    expect(JSON.parse(stored)).toEqual(complaint);
  });
});
```

## Test Scripts

### Package.json Scripts
```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage",
    "test:integration": "vitest --config vitest.integration.config.ts",
    "test:e2e": "playwright test",
    "test:mobile": "detox test"
  }
}
```

### CI/CD Testing
```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:coverage
      
      - name: Run integration tests
        run: npm run test:integration
        env:
          # Prefer Cassandra for integration tests; fallback to Postgres if needed
          CASSANDRA_CONTACT_POINTS: cassandra:9042
          CASSANDRA_KEYSPACE: test_roadwatch
          CASSANDRA_LOCAL_DC: datacenter1
          REDIS_URL: redis://localhost:6379
```

## Best Practices

### Test Organization
- Group tests by feature/service
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)
- Mock external dependencies
- Use factories for test data

### Coverage Goals
- **Unit Tests**: 90%+ code coverage
- **Integration Tests**: Critical paths covered
- **E2E Tests**: User journeys covered
- **Performance Tests**: Load and stress testing

### Test Data Management
- Use factories for consistent test data
- Clean database between tests
- Use transactions for test isolation
- Avoid hardcoded test data

### Continuous Testing
- Run tests on every commit
- Fail fast on test failures
- Parallel test execution
- Test result reporting and notifications