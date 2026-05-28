# Development Tools & Utilities

## Overview
Development tools, utilities, and helpers that support the RoadWatch development workflow. Includes code generation, testing utilities, debugging tools, and development automation.

## Development Utilities

### Code Generation Tools

#### Schema Generator (`tools/schema-gen/`)
Generates TypeScript types and validation schemas from OpenAPI specifications.

```typescript
// Schema generation utility
class SchemaGenerator {
  async generateFromOpenAPI(specPath: string, outputDir: string): Promise<void> {
    const spec = await this.loadOpenAPISpec(specPath);
    
    // Generate TypeScript interfaces
    const interfaces = this.generateInterfaces(spec.components.schemas);
    await this.writeFile(`${outputDir}/types.ts`, interfaces);
    
    // Generate Zod validation schemas
    const zodSchemas = this.generateZodSchemas(spec.components.schemas);
    await this.writeFile(`${outputDir}/schemas.ts`, zodSchemas);
    
    // Generate API client
    const apiClient = this.generateAPIClient(spec.paths);
    await this.writeFile(`${outputDir}/api-client.ts`, apiClient);
  }
  
  private generateInterfaces(schemas: any): string {
    let output = '// Generated TypeScript interfaces\n\n';
    
    for (const [name, schema] of Object.entries(schemas)) {
      output += this.generateInterface(name, schema);
      output += '\n\n';
    }
    
    return output;
  }
  
  private generateInterface(name: string, schema: any): string {
    let interface_def = `export interface ${name} {\n`;
    
    for (const [propName, propSchema] of Object.entries(schema.properties || {})) {
      const optional = !schema.required?.includes(propName) ? '?' : '';
      const type = this.mapOpenAPITypeToTS(propSchema);
      interface_def += `  ${propName}${optional}: ${type};\n`;
    }
    
    interface_def += '}';
    return interface_def;
  }
  
  private generateZodSchemas(schemas: any): string {
    let output = 'import { z } from "zod";\n\n';
    
    for (const [name, schema] of Object.entries(schemas)) {
      output += this.generateZodSchema(name, schema);
      output += '\n\n';
    }
    
    return output;
  }
}

// Usage: npm run generate:schemas
```

#### Database Migration Generator
```typescript
// Migration generator for database schema changes
class MigrationGenerator {
  async generateMigration(name: string, changes: SchemaChange[]): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    const filename = `${timestamp}_${name}.sql`;
    
    let migration = `-- Migration: ${name}\n`;
    migration += `-- Created: ${new Date().toISOString()}\n\n`;
    
    migration += '-- Up migration\n';
    for (const change of changes) {
      migration += this.generateChangeSQL(change) + '\n';
    }
    
    migration += '\n-- Down migration (rollback)\n';
    for (const change of changes.reverse()) {
      migration += this.generateRollbackSQL(change) + '\n';
    }
    
    await this.writeFile(`migrations/${filename}`, migration);
  }
  
  private generateChangeSQL(change: SchemaChange): string {
    switch (change.type) {
      case 'create_table':
        return this.generateCreateTable(change);
      case 'add_column':
        return `ALTER TABLE ${change.table} ADD COLUMN ${change.column} ${change.dataType};`;
      case 'drop_column':
        return `ALTER TABLE ${change.table} DROP COLUMN ${change.column};`;
      case 'create_index':
        return `CREATE INDEX ${change.indexName} ON ${change.table} (${change.columns.join(', ')});`;
      default:
        throw new Error(`Unknown change type: ${change.type}`);
    }
  }
}
```

### Testing Utilities

#### Test Data Factory
```typescript
// Factory for generating test data
class TestDataFactory {
  static createComplaint(overrides?: Partial<Complaint>): Complaint {
    return {
      id: `RW-TEST-${Math.random().toString(36).substr(2, 9)}`,
      citizenId: `citizen-${Math.random().toString(36).substr(2, 9)}`,
      roadId: `road-${Math.random().toString(36).substr(2, 9)}`,
      district: 'Delhi',
      zone: 'Central',
      description: 'Test complaint description',
      damageType: DamageType.POTHOLE,
      severity: Severity.MEDIUM,
      status: ComplaintStatus.PENDING,
      location: {
        lat: 28.6139 + (Math.random() - 0.5) * 0.1,
        lng: 77.2090 + (Math.random() - 0.5) * 0.1
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides
    };
  }
  
  static createUser(overrides?: Partial<User>): User {
    return {
      id: `user-${Math.random().toString(36).substr(2, 9)}`,
      phone: `+9112345${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`,
      phoneHash: 'test-hash',
      role: UserRole.CITIZEN,
      districts: ['Delhi'],
      zones: ['Central'],
      createdAt: new Date(),
      ...overrides
    };
  }
  
  static createBatch<T>(factory: () => T, count: number): T[] {
    return Array.from({ length: count }, factory);
  }
  
  static async seedDatabase(db: Database): Promise<void> {
    // Create test users
    const users = this.createBatch(() => this.createUser(), 10);
    for (const user of users) {
      await db.users.create(user);
    }
    
    // Create test complaints
    const complaints = this.createBatch(() => this.createComplaint({
      citizenId: users[Math.floor(Math.random() * users.length)].id
    }), 50);
    
    for (const complaint of complaints) {
      await db.complaints.create(complaint);
    }
  }
}
```

#### Mock Services
```typescript
// Mock implementations for testing
class MockKafkaProducer implements KafkaProducer {
  private messages: Array<{ topic: string; message: any }> = [];
  
  async send(topic: string, message: any): Promise<void> {
    this.messages.push({ topic, message });
  }
  
  getMessages(topic?: string): any[] {
    return topic 
      ? this.messages.filter(m => m.topic === topic).map(m => m.message)
      : this.messages.map(m => m.message);
  }
  
  clear(): void {
    this.messages = [];
  }
}

class MockFabricGateway implements FabricGateway {
  private transactions: Array<{ method: string; args: any[] }> = [];
  
  async submitTransaction(method: string, ...args: any[]): Promise<string> {
    const txId = `mock-tx-${Date.now()}`;
    this.transactions.push({ method, args });
    return txId;
  }
  
  async evaluateTransaction(method: string, ...args: any[]): Promise<Buffer> {
    return Buffer.from(JSON.stringify({ success: true }));
  }
  
  getTransactions(): Array<{ method: string; args: any[] }> {
    return [...this.transactions];
  }
}

class MockNotificationService implements NotificationService {
  private notifications: Notification[] = [];
  
  async send(notification: Notification): Promise<void> {
    this.notifications.push({
      ...notification,
      id: `mock-notif-${Date.now()}`,
      sentAt: new Date()
    });
  }
  
  getNotifications(userId?: string): Notification[] {
    return userId 
      ? this.notifications.filter(n => n.recipientId === userId)
      : this.notifications;
  }
}
```

### Debugging Tools

#### Request Logger
```typescript
// Enhanced request logging for debugging
class RequestLogger {
  static middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      const requestId = crypto.randomUUID();
      
      // Add request ID to headers
      req.headers['x-request-id'] = requestId;
      res.setHeader('x-request-id', requestId);
      
      // Log request
      console.log(`[${requestId}] ${req.method} ${req.url}`, {
        headers: this.sanitizeHeaders(req.headers),
        body: this.sanitizeBody(req.body),
        query: req.query,
        params: req.params,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      // Log response
      const originalSend = res.send;
      res.send = function(body) {
        const duration = Date.now() - startTime;
        console.log(`[${requestId}] Response ${res.statusCode} (${duration}ms)`, {
          body: typeof body === 'string' ? body.substring(0, 1000) : body
        });
        return originalSend.call(this, body);
      };
      
      next();
    };
  }
  
  private static sanitizeHeaders(headers: any): any {
    const sanitized = { ...headers };
    delete sanitized.authorization;
    delete sanitized.cookie;
    return sanitized;
  }
  
  private static sanitizeBody(body: any): any {
    if (!body) return body;
    
    const sanitized = { ...body };
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.otp;
    return sanitized;
  }
}
```

#### Performance Profiler
```typescript
// Performance profiling utility
class PerformanceProfiler {
  private static profiles = new Map<string, ProfileData>();
  
  static start(name: string): void {
    this.profiles.set(name, {
      startTime: process.hrtime.bigint(),
      memoryStart: process.memoryUsage()
    });
  }
  
  static end(name: string): ProfileResult {
    const profile = this.profiles.get(name);
    if (!profile) {
      throw new Error(`No profile found for: ${name}`);
    }
    
    const endTime = process.hrtime.bigint();
    const memoryEnd = process.memoryUsage();
    
    const result: ProfileResult = {
      name,
      duration: Number(endTime - profile.startTime) / 1_000_000, // Convert to milliseconds
      memoryDelta: {
        rss: memoryEnd.rss - profile.memoryStart.rss,
        heapUsed: memoryEnd.heapUsed - profile.memoryStart.heapUsed,
        heapTotal: memoryEnd.heapTotal - profile.memoryStart.heapTotal
      }
    };
    
    this.profiles.delete(name);
    return result;
  }
  
  static async profile<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      const result = await fn();
      const profile = this.end(name);
      console.log(`Profile [${name}]:`, profile);
      return result;
    } catch (error) {
      this.profiles.delete(name);
      throw error;
    }
  }
}

// Usage
const result = await PerformanceProfiler.profile('complaint-submission', async () => {
  return await complaintService.submit(complaintData);
});
```

### Load Testing Tools

#### K6 Load Test Generator
```typescript
// Generate K6 load test scripts
class K6TestGenerator {
  generateComplaintSubmissionTest(config: LoadTestConfig): string {
    return `
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

export let errorRate = new Rate('errors');

export let options = {
  stages: [
    { duration: '${config.rampUp}', target: ${config.targetVUs} },
    { duration: '${config.duration}', target: ${config.targetVUs} },
    { duration: '${config.rampDown}', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<${config.p95Threshold}'],
    errors: ['rate<${config.errorThreshold}'],
  },
};

export default function() {
  const payload = JSON.stringify({
    district: 'Delhi',
    zone: 'Central',
    description: 'Load test complaint ' + Math.random(),
    lat: 28.6139 + (Math.random() - 0.5) * 0.1,
    lng: 77.2090 + (Math.random() - 0.5) * 0.1,
    damageType: 'POTHOLE',
    severity: 'MEDIUM'
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getAuthToken(),
    },
  };

  const response = http.post('${config.baseUrl}/api/citizen/complaints', payload, params);
  
  check(response, {
    'status is 201': (r) => r.status === 201,
    'response time < ${config.responseTimeThreshold}ms': (r) => r.timings.duration < ${config.responseTimeThreshold},
  });

  errorRate.add(response.status !== 201);
  
  sleep(${config.thinkTime});
}

function getAuthToken() {
  // Implementation to get auth token
  return 'test-token';
}
`;
  }
  
  async runLoadTest(testScript: string): Promise<LoadTestResult> {
    const fs = require('fs');
    const { exec } = require('child_process');
    
    // Write test script to file
    const testFile = `/tmp/loadtest-${Date.now()}.js`;
    fs.writeFileSync(testFile, testScript);
    
    // Run K6 test
    return new Promise((resolve, reject) => {
      exec(`k6 run --out json=${testFile}.json ${testFile}`, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        
        // Parse results
        const results = this.parseK6Results(`${testFile}.json`);
        resolve(results);
      });
    });
  }
}
```

### Development Automation

#### Hot Reload Manager
```typescript
// Hot reload manager for development
class HotReloadManager {
  private watchers: chokidar.FSWatcher[] = [];
  private processes: Map<string, ChildProcess> = new Map();
  
  async start(services: ServiceConfig[]): Promise<void> {
    for (const service of services) {
      await this.startService(service);
      this.watchService(service);
    }
  }
  
  private async startService(config: ServiceConfig): Promise<void> {
    console.log(`Starting ${config.name}...`);
    
    const process = spawn('npm', ['run', 'dev'], {
      cwd: config.path,
      stdio: 'pipe',
      env: { ...process.env, ...config.env }
    });
    
    process.stdout?.on('data', (data) => {
      console.log(`[${config.name}] ${data.toString().trim()}`);
    });
    
    process.stderr?.on('data', (data) => {
      console.error(`[${config.name}] ${data.toString().trim()}`);
    });
    
    this.processes.set(config.name, process);
  }
  
  private watchService(config: ServiceConfig): void {
    const watcher = chokidar.watch(config.watchPaths, {
      ignored: config.ignorePaths,
      persistent: true
    });
    
    watcher.on('change', async (path) => {
      console.log(`File changed: ${path}`);
      
      if (config.hotReload) {
        // Send reload signal to service
        await this.reloadService(config.name);
      } else {
        // Restart service
        await this.restartService(config.name, config);
      }
    });
    
    this.watchers.push(watcher);
  }
  
  private async restartService(name: string, config: ServiceConfig): Promise<void> {
    console.log(`Restarting ${name}...`);
    
    // Kill existing process
    const existingProcess = this.processes.get(name);
    if (existingProcess) {
      existingProcess.kill();
    }
    
    // Start new process
    await this.startService(config);
  }
  
  async stop(): Promise<void> {
    // Stop all watchers
    for (const watcher of this.watchers) {
      await watcher.close();
    }
    
    // Kill all processes
    for (const [name, process] of this.processes) {
      console.log(`Stopping ${name}...`);
      process.kill();
    }
  }
}

interface ServiceConfig {
  name: string;
  path: string;
  watchPaths: string[];
  ignorePaths: string[];
  hotReload: boolean;
  env: Record<string, string>;
}
```

#### Environment Manager
```typescript
// Environment management for development
class EnvironmentManager {
  private environments = new Map<string, Environment>();
  
  async loadEnvironments(): Promise<void> {
    const envDir = path.join(process.cwd(), 'environments');
    const envFiles = await fs.readdir(envDir);
    
    for (const file of envFiles) {
      if (file.endsWith('.env')) {
        const envName = path.basename(file, '.env');
        const envPath = path.join(envDir, file);
        const envVars = await this.parseEnvFile(envPath);
        
        this.environments.set(envName, {
          name: envName,
          variables: envVars,
          filePath: envPath
        });
      }
    }
  }
  
  async switchEnvironment(envName: string): Promise<void> {
    const environment = this.environments.get(envName);
    if (!environment) {
      throw new Error(`Environment ${envName} not found`);
    }
    
    // Update process.env
    for (const [key, value] of Object.entries(environment.variables)) {
      process.env[key] = value;
    }
    
    // Write .env file
    const envContent = Object.entries(environment.variables)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    await fs.writeFile('.env', envContent);
    
    console.log(`Switched to environment: ${envName}`);
  }
  
  async createEnvironment(name: string, baseEnv?: string): Promise<void> {
    const baseEnvironment = baseEnv ? this.environments.get(baseEnv) : null;
    const variables = baseEnvironment ? { ...baseEnvironment.variables } : {};
    
    const environment: Environment = {
      name,
      variables,
      filePath: path.join(process.cwd(), 'environments', `${name}.env`)
    };
    
    this.environments.set(name, environment);
    await this.saveEnvironment(environment);
  }
  
  private async parseEnvFile(filePath: string): Promise<Record<string, string>> {
    const content = await fs.readFile(filePath, 'utf8');
    const variables: Record<string, string> = {};
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          variables[key] = valueParts.join('=');
        }
      }
    }
    
    return variables;
  }
}

interface Environment {
  name: string;
  variables: Record<string, string>;
  filePath: string;
}
```

## CLI Tools

### RoadWatch CLI
```typescript
// Command-line interface for development tasks
class RoadWatchCLI {
  private program = new Command();
  
  constructor() {
    this.setupCommands();
  }
  
  private setupCommands(): void {
    this.program
      .name('roadwatch')
      .description('RoadWatch development CLI')
      .version('1.0.0');
    
    // Environment commands
    this.program
      .command('env:list')
      .description('List available environments')
      .action(this.listEnvironments);
    
    this.program
      .command('env:switch <name>')
      .description('Switch to environment')
      .action(this.switchEnvironment);
    
    // Database commands
    this.program
      .command('db:migrate')
      .description('Run database migrations')
      .action(this.runMigrations);
    
    this.program
      .command('db:seed')
      .description('Seed database with test data')
      .action(this.seedDatabase);
    
    // Testing commands
    this.program
      .command('test:load')
      .description('Run load tests')
      .option('-c, --config <file>', 'Load test configuration file')
      .action(this.runLoadTests);
    
    // Code generation commands
    this.program
      .command('generate:migration <name>')
      .description('Generate database migration')
      .action(this.generateMigration);
  }
  
  async run(args: string[]): Promise<void> {
    await this.program.parseAsync(args);
  }
}

// Usage: npx roadwatch env:switch development
```

## IDE Integration

### VS Code Extensions Configuration
```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-json",
    "redhat.vscode-yaml",
    "ms-vscode-remote.remote-containers"
  ],
  "settings": {
    "typescript.preferences.importModuleSpecifier": "relative",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.fixAll.eslint": true
    },
    "files.associations": {
      "*.env.*": "properties"
    }
  }
}
```

### Development Container
```dockerfile
# .devcontainer/Dockerfile
FROM node:18-alpine

# Install development tools
RUN apk add --no-cache \
    git \
    curl \
    bash \
    postgresql-client \
    redis

# Install global npm packages
RUN npm install -g \
    pnpm \
    tsx \
    nodemon \
    @types/node

# Set up workspace
WORKDIR /workspace
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

# Development user
RUN addgroup -g 1000 developer && \
    adduser -D -s /bin/bash -u 1000 -G developer developer

USER developer
```