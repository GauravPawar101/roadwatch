# Development Tools

## Overview
The RoadWatch project includes various development tools for testing, code generation, and system validation.

## Testing Tools

### Chaos Engineering (`tools/chaos/`)
Tools for chaos engineering and resilience testing to validate system behavior under failure conditions.

**Purpose**: Test system resilience by introducing controlled failures
**Usage**: Simulate network partitions, service failures, and resource constraints

```bash
# Run chaos tests
cd tools/chaos
npm run chaos:network-partition
npm run chaos:service-failure
npm run chaos:resource-exhaustion
```

### Load Testing (`tools/load/`)
Performance and load testing utilities to validate system capacity and identify bottlenecks.

**Purpose**: Measure system performance under various load conditions
**Usage**: Generate realistic traffic patterns and measure response times

```bash
# Run load tests
cd tools/load
npm run load:baseline
npm run load:stress
npm run load:spike
```

### Fabric Testing (`tools/fabric-test/`)
Hyperledger Fabric blockchain network testing utilities for chaincode validation.

**Purpose**: Test blockchain functionality and chaincode deployment
**Usage**: Validate smart contract behavior and network connectivity

```bash
# Test Fabric network
cd tools/fabric-test
npm run fabric:test-network
npm run fabric:test-chaincode
npm run fabric:test-queries
```

### Prompt Testing (`tools/prompt-tests/`)
AI prompt testing and validation tools for ensuring consistent AI behavior.

**Purpose**: Test and validate AI prompt responses for quality and consistency
**Usage**: Automated testing of AI-generated content and responses

```bash
# Run prompt tests
cd tools/prompt-tests
npm run prompt:test-all
npm run prompt:validate-responses
npm run prompt:benchmark
```

## Code Generation Tools

### Schema Generation (`tools/schema-gen/`)
Automated schema and type generation from various sources (OpenAPI, GraphQL, Database).

**Purpose**: Generate TypeScript types and validation schemas
**Usage**: Keep types in sync across services and databases

```bash
# Generate schemas
cd tools/schema-gen
npm run schema:generate-types
npm run schema:generate-validators
npm run schema:generate-docs
```

**Configuration**:
```typescript
// schema-gen.config.ts
export default {
  sources: {
    openapi: './api-spec.yaml',
    // For schema generation prefer connecting to PgBouncer-backed Postgres or provide a DB connection string
    database: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:6432/roadwatch',
    graphql: './schema.graphql'
  },
  outputs: {
    types: './src/types/generated.ts',
    validators: './src/validators/generated.ts',
    docs: './docs/api/generated.md'
  }
};
```

### Import Rewriter (`tools/codemod-rewrite-imports.cjs`)
Codemod tool for automatically rewriting import statements across the codebase.

**Purpose**: Refactor import paths when moving or renaming modules
**Usage**: Automated code transformation for large-scale refactoring

```bash
# Rewrite imports
node tools/codemod-rewrite-imports.cjs --from "@old/package" --to "@new/package"
```

## Tool Integration

### CI/CD Integration
```yaml
# .github/workflows/tools.yml
name: Development Tools
on: [push, pull_request]

jobs:
  schema-validation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Generate and validate schemas
        run: |
          cd tools/schema-gen
          npm ci
          npm run schema:generate-types
          npm run schema:validate
  
  load-testing:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - name: Run load tests
        run: |
          cd tools/load
          npm ci
          npm run load:baseline
  
  chaos-testing:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v3
      - name: Run chaos tests
        run: |
          cd tools/chaos
          npm ci
          npm run chaos:full-suite
```

### Development Workflow
```bash
# Pre-commit hooks
#!/bin/sh
# .git/hooks/pre-commit

# Generate schemas if changed
if git diff --cached --name-only | grep -q "api-spec.yaml\|schema.graphql"; then
  cd tools/schema-gen
  npm run schema:generate-types
  git add src/types/generated.ts
fi

# Run prompt tests if prompts changed
if git diff --cached --name-only | grep -q "core/prompts/"; then
  cd tools/prompt-tests
  npm run prompt:test-changed
fi
```

## Tool Configuration

### Shared Configuration
```typescript
// tools/shared/config.ts
export interface ToolConfig {
  environment: 'development' | 'staging' | 'production';
  services: {
    gatewayApi: string;
    fabricNetwork: string;
    database: string;
  };
  timeouts: {
    default: number;
    load: number;
    chaos: number;
  };
}

export const getToolConfig = (): ToolConfig => ({
  environment: process.env.NODE_ENV as any || 'development',
  services: {
    gatewayApi: process.env.GATEWAY_API_URL || 'http://localhost:3100',
    fabricNetwork: process.env.FABRIC_NETWORK_URL || 'localhost:7051',
    // Prefer the pooled Postgres endpoint; fall back to an explicit connection string
    database: {
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:6432/roadwatch'
    }
  },
  timeouts: {
    default: 30000,
    load: 300000,
    chaos: 600000
  }
});
```

### Tool Utilities
```typescript
// tools/shared/utils.ts
export class ToolLogger {
  constructor(private toolName: string) {}
  
  info(message: string, data?: any): void {
    console.log(`[${this.toolName}] ${message}`, data || '');
  }
  
  error(message: string, error?: Error): void {
    console.error(`[${this.toolName}] ERROR: ${message}`, error?.stack || '');
  }
  
  success(message: string): void {
    console.log(`[${this.toolName}] ✅ ${message}`);
  }
}

export class MetricsCollector {
  private metrics: Map<string, number[]> = new Map();
  
  record(metric: string, value: number): void {
    if (!this.metrics.has(metric)) {
      this.metrics.set(metric, []);
    }
    this.metrics.get(metric)!.push(value);
  }
  
  getStats(metric: string): { avg: number; min: number; max: number; count: number } {
    const values = this.metrics.get(metric) || [];
    return {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length
    };
  }
}
```

## Best Practices

### Tool Development
- Keep tools focused and single-purpose
- Use shared configuration and utilities
- Include comprehensive error handling
- Provide clear output and progress indicators
- Support both CLI and programmatic usage

### Testing Strategy
- Test tools in isolated environments
- Use realistic test data and scenarios
- Validate tool outputs and side effects
- Include performance benchmarks
- Document expected behavior and limitations

### Maintenance
- Keep tools updated with system changes
- Version tool configurations
- Monitor tool performance and reliability
- Provide clear documentation and examples
- Integrate tools into development workflow