# Scripts & Utilities

## Overview
Build scripts, automation tools, and utilities that support development, testing, and deployment of the RoadWatch system.

## Script Categories

### Build & Development Scripts

#### Fabric Ledger Script (`scripts/fabric-ledger.ts`)
Utility for interacting with Hyperledger Fabric ledger for testing and data management.

```typescript
// Fabric ledger operations
class FabricLedgerScript {
  async seed(): Promise<void> {
    // Seed blockchain with test data
    await this.createTestComplaints();
    await this.createTestAuthorities();
    await this.anchorTestMerkleRoots();
  }
  
  async history(complaintId: string): Promise<void> {
    // Get complaint history from blockchain
    const history = await this.fabricGateway.getComplaintHistory(complaintId);
    console.log('Complaint History:', JSON.stringify(history, null, 2));
  }
  
  async queryByRoad(roadId: string): Promise<void> {
    // Query complaints by road ID
    const complaints = await this.fabricGateway.queryComplaintsByRoad(roadId);
    console.log(`Complaints for road ${roadId}:`, complaints);
  }
  
  private async createTestComplaints(): Promise<void> {
    const testComplaints = [
      {
        id: 'RW-DL-001',
        roadId: 'NH48-DL-001',
        citizenId: 'citizen-001',
        location: 'Connaught Place, Delhi',
        description: 'Large pothole causing traffic issues'
      },
      // More test complaints...
    ];
    
    for (const complaint of testComplaints) {
      await this.fabricGateway.createComplaint(complaint);
    }
  }
}

// Usage
// npm run fabric:seed - Seed test data
// npm run fabric:history RW-DL-001 - Get complaint history
// npm run fabric:by-road NH48-DL-001 - Query by road
```

#### Backend Seed Script (`scripts/seed-backend.ts`)
Seeds PostgreSQL database with test data for development and testing.

```typescript
// Database seeding utility
class BackendSeeder {
  async seedAll(): Promise<void> {
    await this.seedUsers();
    await this.seedRoads();
    await this.seedComplaints();
    await this.seedContractors();
    await this.seedAnalyticsEvents();
  }
  
  private async seedUsers(): Promise<void> {
    const testUsers = [
      {
        phone: '+911234567890',
        role: 'CITIZEN',
        districts: ['Delhi'],
        zones: ['Central']
      },
      {
        phone: '+919876543210',
        role: 'EE',
        districts: ['Delhi'],
        zones: ['Central', 'North']
      },
      {
        phone: '+918765432109',
        role: 'CE',
        districts: ['Delhi'],
        zones: ['Central', 'North', 'South']
      }
    ];
    
    for (const user of testUsers) {
      await this.createUser(user);
    }
  }
  
  private async seedRoads(): Promise<void> {
    const testRoads = [
      {
        id: 'NH48-DL-001',
        name: 'National Highway 48 - Delhi Section',
        type: 'NATIONAL_HIGHWAY',
        districtId: 'delhi-central',
        authorityId: 'nhai-delhi',
        geometry: {
          type: 'LineString',
          coordinates: [[77.2090, 28.6139], [77.2290, 28.6339]]
        }
      }
      // More test roads...
    ];
    
    for (const road of testRoads) {
      await this.createRoad(road);
    }
  }
}

// Usage: npm run seed:backend
```

#### Test ID Generator (`scripts/test-ids.ts`)
Generates consistent test IDs for development and testing environments.

```typescript
// Deterministic test ID generation
class TestIdGenerator {
  private static readonly SEEDS = {
    COMPLAINT: 'complaint-seed-2024',
    USER: 'user-seed-2024',
    ROAD: 'road-seed-2024'
  };
  
  static generateComplaintId(index: number): string {
    const hash = this.hash(`${this.SEEDS.COMPLAINT}-${index}`);
    return `RW-TEST-${hash.substring(0, 8).toUpperCase()}`;
  }
  
  static generateUserId(index: number): string {
    const hash = this.hash(`${this.SEEDS.USER}-${index}`);
    return `user-${hash.substring(0, 12)}`;
  }
  
  static generateRoadId(index: number): string {
    const hash = this.hash(`${this.SEEDS.ROAD}-${index}`);
    return `road-${hash.substring(0, 10)}`;
  }
  
  private static hash(input: string): string {
    // Simple hash function for deterministic IDs
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}
```

### Automation Scripts

#### Start/Stop Scripts
Platform-specific scripts for starting and stopping all services.

**Windows PowerShell** (`start-all.ps1`)
```powershell
# Start all RoadWatch services on Windows
Write-Host "Starting RoadWatch services..." -ForegroundColor Green

# Start infrastructure services (Postgres preferred)
Write-Host "Starting Postgres (via Docker Compose)..." -ForegroundColor Yellow
Start-Process -FilePath "docker" -ArgumentList "compose up -d postgres"

Write-Host "Starting Redis..." -ForegroundColor Yellow
Start-Process -FilePath "docker" -ArgumentList "compose up -d redis"

Write-Host "Starting Kafka..." -ForegroundColor Yellow
Start-Process -FilePath "docker" -ArgumentList "compose up -d kafka zookeeper"

# Start application services
Write-Host "Starting Gateway API..." -ForegroundColor Yellow
Start-Process -FilePath "pnpm" -ArgumentList "--filter @roadwatch/gateway-api dev"

Write-Host "Starting Frontend..." -ForegroundColor Yellow
Start-Process -FilePath "pnpm" -ArgumentList "--filter roadwatch-frontend dev"

Write-Host "Starting Fabric Anchor Consumer..." -ForegroundColor Yellow
Start-Process -FilePath "pnpm" -ArgumentList "run dev --filter @roadwatch/fabric-anchor-consumer"

Write-Host "All services started!" -ForegroundColor Green
```

**Unix/Linux Shell** (`start-all.sh`)
```bash
#!/bin/bash
# Start all RoadWatch services on Unix/Linux

echo "Starting RoadWatch services..."

# Start infrastructure services (Postgres preferred)
echo "Starting Postgres (Docker Compose)..."
docker compose up -d postgres

echo "Starting Redis..."
docker compose up -d redis

echo "Starting Kafka..."
docker compose up -d kafka zookeeper

# Start application services
echo "Starting Gateway API..."
pnpm --filter @roadwatch/gateway-api dev &

echo "Starting Frontend..."
pnpm --filter roadwatch-frontend dev &

echo "Starting Fabric Anchor Consumer..."
pnpm run dev --filter @roadwatch/fabric-anchor-consumer &

echo "All services started!"
```

**Stop Script** (`stop-all.sh`)
```bash
#!/bin/bash
# Stop all RoadWatch services

echo "Stopping RoadWatch services..."

# Stop application services
pkill -f "gateway-api"
pkill -f "authority-portal"
pkill -f "fabric-anchor-consumer"

# Stop infrastructure services
pg_ctl stop -D /usr/local/var/postgres
redis-cli shutdown
kafka-server-stop.sh

echo "All services stopped!"
```

### Code Generation & Transformation

#### Import Rewriter (`tools/codemod-rewrite-imports.cjs`)
Codemod for updating import statements across the codebase.

```javascript
// Codemod for rewriting imports
module.exports = function transformer(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  
  // Rewrite relative imports to workspace imports
  root.find(j.ImportDeclaration)
    .filter(path => {
      const source = path.value.source.value;
      return source.startsWith('../') && source.includes('packages/');
    })
    .forEach(path => {
      const source = path.value.source.value;
      
      // Convert ../packages/core to @roadwatch/core
      if (source.includes('packages/core')) {
        path.value.source.value = '@roadwatch/core';
      }
      // Convert ../packages/adapters to @roadwatch/adapters
      else if (source.includes('packages/adapters')) {
        path.value.source.value = '@roadwatch/adapters';
      }
      // Add more transformations as needed
    });
  
  return root.toSource();
};

// Usage: npx jscodeshift -t tools/codemod-rewrite-imports.cjs src/
```

## Package.json Scripts

### Root Level Scripts
```json
{
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "test:unit": "turbo run test --filter=@roadwatch/core",
    "test:integration": "turbo run test --filter=@roadwatch/gateway-api",
    "test:prompts": "tsx tools/prompt-tests/run.ts",
    "test:fabric": "vitest run -c tests/fabric/vitest.config.ts",
    "loadtest": "node tools/load/run-k6.mjs",
    "chaostest": "node tools/chaos/run.mjs",
    "seed:backend": "pnpm -F @roadwatch/gateway-api seed:backend",
    "seed:fabric": "tsx scripts/fabric-ledger.ts seed",
    "query:fabric:history": "tsx scripts/fabric-ledger.ts history",
    "query:fabric:by-road": "tsx scripts/fabric-ledger.ts by-road",
    "clean": "turbo run clean && rm -rf node_modules",
    "start": "pnpm --filter @roadwatch/mobile-host start"
  }
}
```

### Service-Specific Scripts
Each service has its own package.json with specific scripts:

```json
// Gateway API scripts
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "seed:backend": "tsx scripts/seed-backend.ts",
    "migrate": "tsx scripts/migrate.ts"
  }
}

// Frontend scripts
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  }
}

// Mobile Host scripts
{
  "scripts": {
    "start": "react-native start",
    "android": "react-native run-android",
    "ios": "react-native run-ios",
    "build:android": "cd android && ./gradlew assembleRelease",
    "build:ios": "cd ios && xcodebuild -workspace RoadWatch.xcworkspace -scheme RoadWatch -configuration Release"
  }
}
```

## Environment Management

### Environment Files
```bash
# .env.example - Template for environment variables (PgBouncer-backed Postgres)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:6432/roadwatch
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=roadwatch
KAFKA_BROKERS=localhost:9092
REDIS_URL=redis://localhost:6379
FABRIC_PEER_ENDPOINT=peer0.roadwatch.com:7051
JWT_SECRET=your-jwt-secret-here
GEMINI_API_KEY=your-gemini-api-key

# Development overrides
NODE_ENV=development
LOG_LEVEL=debug
ENABLE_CORS=true
```

### Configuration Validation
```typescript
// Environment validation script
class EnvValidator {
  static validate(): void {
    const required = [
      'DATABASE_URL',
      'POSTGRES_HOST',
      'JWT_SECRET',
      'FABRIC_PEER_ENDPOINT'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error('Missing required environment variables:', missing);
      process.exit(1);
    }
    
    console.log('Environment validation passed ✓');
  }
}
```

## Usage Examples

### Development Workflow
```bash
# Initial setup
pnpm install
cp .env.example .env
# Edit .env with your configuration

# Start all services
./start-all.sh

# Run tests
pnpm test

# Seed data
pnpm seed:backend
pnpm seed:fabric

# Build for production
pnpm build
```

### Testing Workflow
```bash
# Run unit tests
pnpm test:unit

# Run integration tests
pnpm test:integration

# Run fabric tests
pnpm test:fabric

# Load testing
pnpm loadtest

# Chaos testing
pnpm chaostest
```

### Deployment Workflow
```bash
# Build all services
pnpm build

# Run migrations
pnpm migrate

# Start production services
NODE_ENV=production pnpm start
```

## Maintenance Scripts

### Database Maintenance
```typescript
// Database cleanup and optimization
class DatabaseMaintenance {
  async cleanup(): Promise<void> {
    // Remove old analytics events (older than 1 year)
    await this.cleanupOldAnalytics();
    
    // Vacuum and analyze tables
    await this.optimizeTables();
    
    // Update statistics
    await this.updateStatistics();
  }
  
  private async cleanupOldAnalytics(): Promise<void> {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    await this.db.query(
      'DELETE FROM analytics_events WHERE created_at < $1',
      [oneYearAgo]
    );
  }
}
```

### Log Rotation
```bash
#!/bin/bash
# Log rotation script
LOG_DIR="/var/log/roadwatch"
MAX_SIZE="100M"
MAX_AGE="30d"

# Rotate logs
logrotate -f /etc/logrotate.d/roadwatch

# Compress old logs
find $LOG_DIR -name "*.log.*" -not -name "*.gz" -exec gzip {} \;

# Remove old compressed logs
find $LOG_DIR -name "*.log.*.gz" -mtime +30 -delete
```