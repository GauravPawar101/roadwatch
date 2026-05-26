# RoadWatch Services Documentation

# RoadWatch Services Documentation

## Overview
This documentation provides comprehensive information about all services in the RoadWatch complaint management system. Each service is documented with its architecture, key functions, data models, and important implementation details.

## 📁 Documentation Structure

### 🚀 Getting Started
- **[Setup Checklist](./infrastructure/setup-checklist.md)** - Complete step-by-step setup guide
- **[Docker Quick Reference](./infrastructure/docker-quick-ref.md)** - Quick commands and troubleshooting
- **[Test Credentials](./test-credentials.md)** - Development credentials and testing

### 🏗️ Infrastructure & Operations
- **[Docker Setup](./infrastructure/docker-setup.md)** - Comprehensive Docker infrastructure guide
- **[Docker Rewrite Summary](./infrastructure/docker-rewrite-summary.md)** - Infrastructure improvements overview
- **[Docker Rewrite Complete](./infrastructure/docker-rewrite-complete.md)** - Complete infrastructure rewrite details
- **[Deployment Guide](./deployment.md)** - Production deployment procedures

### 🏛️ Architecture & Design
- **[Design Choices](./architecture/design-choices.md)** - Technical decisions and rationale
- **[Adapter Pattern](./architecture/adapter-pattern.md)** - Flexible, pluggable implementations
- **[Event System](./architecture/event-system.md)** - Event-driven architecture patterns
- **[Shared Dependency Strategy](./architecture/shared-dependency-strategy.md)** - How to reduce coupling from shared utilities
- **[Service Integration](./architecture/service-integration.md)** - How services communicate and integrate
- **[Service Inventory](./services/service-inventory.md)** - Complete service architecture and dependencies
- **[Service Verification](./services/service-verification.md)** - Service configuration and health checks

### 🔧 Core Services
- **[Gateway API](./services/gateway-api/README.md)** - Central REST API backend
- **[Authority Portal](./services/authority-portal/README.md)** - React web dashboard for authorities
- **[Mobile Host](./services/mobile-host/README.md)** - React Native citizen mobile app
- **[Chaincode](./services/chaincode/README.md)** - Hyperledger Fabric smart contract
- **[Fabric Anchor Consumer](./services/fabric-anchor-consumer/README.md)** - Kafka consumer for blockchain anchoring
- **[Fabric Chaincodes](./services/fabric-chaincodes/README.md)** - Go-based registry and routing chaincodes

### 📦 Shared Packages
- **[Core Domain](./services/core/README.md)** - Domain models and business logic
- **[Adapters](./services/adapters/README.md)** - Country-specific business logic
- **[Providers](./services/providers/README.md)** - Infrastructure integrations
- **[Packages](./services/packages/README.md)** - Shared TypeScript packages and utilities
- **[Redis Provider](./services/redis-provider/README.md)** - Caching and idempotency management

### 💡 Implementation Guides
- **[Image Submission System](./implementation/image-submission-system.md)** - Complete image verification and karma system
- **[Implementation Summary](./implementation/implementation-summary.md)** - Overview of recent implementations

### 🛠️ Development & Operations
- **[Development Tools](./development/dev-tools.md)** - Development utilities and helpers
- **[Tools](./development/tools.md)** - Chaos testing, load testing, schema generation
- **[Scripts](./development/scripts.md)** - Build scripts, seed data, and automation tools
- **[Configuration](./infrastructure/configuration.md)** - Environment and deployment configuration
- **[Monitoring](./operations/monitoring.md)** - Logging, metrics, and health checks

### 🧪 Testing
- **[Fabric Integration Testing](./testing/fabric-integration-testing.md)** - Local Fabric network testing guide
- **[Testing Strategy](./testing-strategy.md)** - Overall testing approach
- **[Testing Infrastructure](./testing/testing-infrastructure.md)** - Test frameworks and utilities

### 📊 System Features
- **[Analytics System](./analytics-system.md)** - Public analytics and reporting
- **[Ministry Report Format](./ministry-report-format.md)** - Government reporting specifications
- **[RTI Workflow](./rti-workflow.md)** - Right to Information compliance
- **[Onboarding Operations](./onboarding-ops.md)** - User onboarding workflows

### 🔐 Security & Compliance
- **[Court Admissible Blockchain Receipt](./court-admissible-blockchain-receipt.md)** - Legal compliance documentation
- **[Privacy Ledger Retention](./privacy-ledger-retention.md)** - Data privacy and retention policies

### 📋 Complete Index
- **[Documentation Index](./INDEX.md)** - Complete index of all documentation

## System Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Mobile App    │    │ Authority Portal│    │   Public Web    │
│  (React Native)│    │    (React)      │    │   Dashboard     │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼───────────────┐
                    │        Gateway API          │
                    │      (Express.js)           │
                    └─────────────┬───────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
    ┌─────▼─────┐        ┌────────▼────────┐    ┌────────▼────────┐
      │Postgres   │        │     Kafka       │    │ Hyperledger     │
      │ Database  │        │ Event Stream    │    │    Fabric       │
    └───────────┘        └─────────────────┘    └─────────────────┘
                                  │                       ▲
                                  │                       │
                         ┌────────▼────────┐             │
                         │ Fabric Anchor   │─────────────┘
                         │   Consumer      │
                         └─────────────────┘
```

## Data Flow

### Complaint Lifecycle
1. **Submission**: Citizen submits complaint via mobile app
2. **Validation**: Gateway API validates location and data
3. **Storage**: Complaint stored in Postgres (normalized tables)
4. **Event Publishing**: `complaint.submitted` event sent to Kafka
5. **Blockchain Anchoring**: Fabric consumer batches and anchors to blockchain
6. **Authority Assignment**: Complaint routed to appropriate authority
7. **Status Updates**: Authority updates status via web portal
8. **Notifications**: Real-time updates sent to all stakeholders
9. **Resolution**: Complaint resolved with evidence and audit trail

### Event-Driven Architecture
- **Kafka Topics**: 16 different event types for async processing
- **Real-time Updates**: Server-Sent Events (SSE) for live dashboard updates
- **Blockchain Integration**: Merkle tree batching for efficient anchoring
- **Notification Fanout**: Multi-channel notifications (FCM, SMS, Email)

## Key Technologies

### Backend
- **Node.js/TypeScript** - Runtime and language
- **Express.js** - Web framework
- **Postgres** - Primary application database
- **Kafka** - Event streaming
- **Hyperledger Fabric** - Blockchain platform

### Frontend
- **React 18** - Web UI framework
- **React Native 0.73** - Mobile framework
- **TypeScript** - Type safety
- **Vite** - Build tool for web
- **Metro** - Build tool for mobile

### Infrastructure
- **Docker** - Containerization
- **Kubernetes** - Orchestration (production)
- **Redis** - Caching layer
- **NGINX** - Load balancing and reverse proxy

## Security Features

### Authentication & Authorization
- **JWT Tokens** - Stateless authentication
- **OTP Verification** - Phone-based login
- **Role-Based Access Control** - CE, EE, CITIZEN roles
- **Multi-Factor Authentication** - Biometric support on mobile

### Data Protection
- **Phone Number Encryption** - PII protection
- **Private Data Collections** - Blockchain privacy
- **Input Validation** - Zod schema validation
- **SQL Injection Prevention** - Parameterized queries

### Blockchain Security
- **MSP-Based Access Control** - Organization-level permissions
- **Endorsement Policies** - Multi-party transaction approval
- **Immutable Audit Trails** - Tamper-proof history
- **Private Data Collections** - Off-ledger PII storage

## Performance Characteristics

### Scalability
- **Horizontal Scaling** - Stateless API design
- **Event-Driven Processing** - Async workload distribution
- **Database Sharding** - Geographic partitioning
- **CDN Integration** - Static asset delivery

### Reliability
- **Circuit Breakers** - Fault tolerance
- **Retry Logic** - Exponential backoff
- **Dead Letter Queues** - Failed event handling
- **Health Checks** - Service monitoring

### Efficiency
- **Connection Pooling** - Database optimization
- **Batch Processing** - Blockchain efficiency
- **Caching Layers** - Response time optimization
- **Offline Support** - Mobile resilience

## Deployment Architecture

### Development
- **Local Docker Compose** - Full stack development
- **Hot Reloading** - Fast development cycles
- **Mock Services** - Isolated testing
- **Seed Data** - Consistent test environment

### Production
- **Kubernetes Clusters** - Container orchestration
- **Load Balancers** - Traffic distribution
- **Auto Scaling** - Dynamic resource allocation
- **Monitoring Stack** - Observability and alerting

## Getting Started

### Prerequisites
- Node.js 18+
- Docker and Docker Compose
- PostgreSQL 14+
- Kafka 2.8+

### Quick Start
```bash
# Clone repository
git clone <repository-url>
cd roadwatch

# Install dependencies
pnpm install

# Start development environment
docker-compose up -d

# Run database migrations
pnpm run migrate

# Seed test data
pnpm run seed

# Start all services
pnpm run dev
```

### Service-Specific Setup
Each service has its own README with detailed setup instructions:
- [Gateway API Setup](./services/gateway-api/README.md#setup)
- [Authority Portal Setup](./services/authority-portal/README.md#setup)
- [Mobile App Setup](./services/mobile-host/README.md#setup)
- [Blockchain Setup](./services/chaincode/README.md#deployment)

## API Documentation

### REST Endpoints
- **Authentication**: `/auth/*` - OTP-based login
- **Citizen APIs**: `/citizen/*` - Complaint submission and tracking
- **Authority APIs**: `/authority/*` - Complaint management
- **Public APIs**: `/public/*` - Analytics and dashboards
- **Admin APIs**: `/admin/*` - System administration

### Real-time APIs
- **Server-Sent Events**: `/events` - Live updates
- **WebSocket**: `/ws` - Bidirectional communication
- **Push Notifications**: FCM integration

### Blockchain APIs
- **Smart Contract**: Fabric chaincode functions
- **Query APIs**: Historical data and audit trails
- **Event Listeners**: Blockchain event processing

## Monitoring & Observability

### Metrics
- **Application Metrics** - Request rates, latency, errors
- **Business Metrics** - Complaint volumes, resolution times
- **Infrastructure Metrics** - CPU, memory, disk usage
- **Blockchain Metrics** - Transaction throughput, block times

### Logging
- **Structured Logging** - JSON format with correlation IDs
- **Log Aggregation** - Centralized log collection
- **Error Tracking** - Exception monitoring and alerting
- **Audit Trails** - Compliance and security logging

### Alerting
- **SLA Violations** - Complaint resolution delays
- **System Health** - Service availability and performance
- **Security Events** - Authentication failures and anomalies
- **Business KPIs** - Operational metrics and thresholds

## Contributing

### Development Workflow
1. Create feature branch from main
2. Implement changes with tests
3. Run full test suite
4. Submit pull request
5. Code review and approval
6. Merge to main

### Code Standards
- **TypeScript** - Strict type checking
- **ESLint** - Code quality rules
- **Prettier** - Code formatting
- **Jest** - Unit testing framework
- **Conventional Commits** - Commit message format

### Testing Strategy
- **Unit Tests** - Individual function testing
- **Integration Tests** - Service interaction testing
- **E2E Tests** - Full workflow testing
- **Performance Tests** - Load and stress testing
- **Security Tests** - Vulnerability scanning

## Support & Maintenance

### Documentation Updates
- Keep service READMEs current with code changes
- Update API documentation for endpoint changes
- Maintain deployment guides for infrastructure changes
- Document configuration changes and migrations

### Version Management
- Semantic versioning for all services
- Backward compatibility for API changes
- Database migration scripts
- Deployment rollback procedures

For detailed information about each service, please refer to the individual service documentation linked above.