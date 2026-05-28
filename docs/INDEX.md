# RoadWatch Documentation Index

Complete index of all documentation in the RoadWatch system.

## 🚀 Getting Started

| Document | Description | Location |
|----------|-------------|----------|
| **Current State** | Snapshot of the repo as it exists now | [current-state.md](./current-state.md) |
| **Setup Checklist** | Complete step-by-step setup guide | [infrastructure/setup-checklist.md](./infrastructure/setup-checklist.md) |
| **Docker Setup** | Comprehensive Docker infrastructure guide | [infrastructure/docker-setup.md](./infrastructure/docker-setup.md) |
| **Docker Quick Reference** | Quick commands and troubleshooting | [infrastructure/docker-quick-ref.md](./infrastructure/docker-quick-ref.md) |

## 🏗️ Infrastructure & Operations

| Document | Description | Location |
|----------|-------------|----------|
| **Docker Rewrite Summary** | Infrastructure improvements overview | [infrastructure/docker-rewrite-summary.md](./infrastructure/docker-rewrite-summary.md) |
| **Docker Rewrite Complete** | Complete infrastructure rewrite details | [infrastructure/docker-rewrite-complete.md](./infrastructure/docker-rewrite-complete.md) |
| **Configuration** | Environment and deployment configuration | [infrastructure/configuration.md](./infrastructure/configuration.md) |
| **Deployment Guide** | Production deployment procedures | [deployment.md](./deployment.md) |

## 🏛️ Architecture & Design

| Document | Description | Location |
|----------|-------------|----------|
| **Design Choices** | Technical decisions and rationale | [architecture/design-choices.md](./architecture/design-choices.md) |
| **Adapter Pattern** | Flexible, pluggable implementations | [architecture/adapter-pattern.md](./architecture/adapter-pattern.md) |
| **Event System** | Event-driven architecture patterns | [architecture/event-system.md](./architecture/event-system.md) |
| **Shared Dependency Strategy** | How to handle shared utilities across services | [architecture/shared-dependency-strategy.md](./architecture/shared-dependency-strategy.md) |
| **Service Integration** | How services communicate and integrate | [architecture/service-integration.md](./architecture/service-integration.md) |
| **Service Inventory** | Complete service architecture and dependencies | [services/service-inventory.md](./services/service-inventory.md) |
| **Service Verification** | Service configuration and health checks | [services/service-verification.md](./services/service-verification.md) |

## 🔧 Core Services

| Document | Description | Location |
|----------|-------------|----------|
| **Gateway API** | Central REST API backend documentation | [services/gateway-api/README.md](./services/gateway-api/README.md) |
| **Backend API** | Auxiliary complaint and media backend documentation | [services/backend-api/README.md](./services/backend-api/README.md) |
| **Authority Portal** | React web dashboard for authorities | [services/authority-portal/README.md](./services/authority-portal/README.md) |
| **Mobile Host** | React Native citizen mobile app | [services/mobile-host/README.md](./services/mobile-host/README.md) |
| **Chaincode** | Hyperledger Fabric smart contract | [services/chaincode/README.md](./services/chaincode/README.md) |
| **Fabric Anchor Consumer** | Kafka consumer for blockchain anchoring | [services/fabric-anchor-consumer/README.md](./services/fabric-anchor-consumer/README.md) |
| **Scheduler** | Cron-based maintenance service | [services/scheduler/README.md](./services/scheduler/README.md) |
| **Webhook Handler** | Kafka event side-effect processor | [services/webhook-handler/README.md](./services/webhook-handler/README.md) |
| **Media Ingest Prototype** | Legacy standalone media ingestion backend | [services/media-ingest/README.md](./services/media-ingest/README.md) |
| **Fabric Chaincodes** | Go-based registry and routing chaincodes | [services/fabric-chaincodes/README.md](./services/fabric-chaincodes/README.md) |

## 📦 Shared Packages

| Document | Description | Location |
|----------|-------------|----------|
| **Core Domain** | Domain models and business logic | [services/core/README.md](./services/core/README.md) |
| **Adapters** | Country-specific business logic | [services/adapters/README.md](./services/adapters/README.md) |
| **Providers** | Infrastructure integrations | [services/providers/README.md](./services/providers/README.md) |
| **Packages** | Shared TypeScript packages and utilities | [services/packages/README.md](./services/packages/README.md) |
| **Shared Packages** | Monorepo packages and shared libraries | [services/packages/shared-packages.md](./services/packages/shared-packages.md) |
| **Redis Provider** | Caching and idempotency management | [services/redis-provider/README.md](./services/redis-provider/README.md) |

## 💡 Implementation Guides

| Document | Description | Location |
|----------|-------------|----------|
| **Image Submission System** | Complete image verification and karma system | [implementation/image-submission-system.md](./implementation/image-submission-system.md) |
| **Implementation Summary** | Overview of recent implementations | [implementation/implementation-summary.md](./implementation/implementation-summary.md) |

## 🧪 Testing

| Document | Description | Location |
|----------|-------------|----------|
| **Fabric Integration Testing** | Local Fabric network testing guide | [testing/fabric-integration-testing.md](./testing/fabric-integration-testing.md) |
| **Testing Strategy** | Overall testing approach | [testing-strategy.md](./testing-strategy.md) |
| **Testing Infrastructure** | Test frameworks and utilities | [testing/testing-infrastructure.md](./testing/testing-infrastructure.md) |
| **Test Credentials** | Development credentials and testing | [test-credentials.md](./test-credentials.md) |

## 🛠️ Development

| Document | Description | Location |
|----------|-------------|----------|
| **Development Tools** | Development utilities and helpers | [development/dev-tools.md](./development/dev-tools.md) |
| **Tools** | Chaos testing, load testing, schema generation | [development/tools.md](./development/tools.md) |
| **Scripts** | Build scripts, seed data, and automation tools | [development/scripts.md](./development/scripts.md) |

## 📊 System Features

| Document | Description | Location |
|----------|-------------|----------|
| **Analytics System** | Public analytics and reporting | [analytics-system.md](./analytics-system.md) |
| **Ministry Report Format** | Government reporting specifications | [ministry-report-format.md](./ministry-report-format.md) |
| **RTI Workflow** | Right to Information compliance | [rti-workflow.md](./rti-workflow.md) |

## 🔐 Security & Compliance

| Document | Description | Location |
|----------|-------------|----------|
| **Court Admissible Blockchain Receipt** | Legal compliance documentation | [court-admissible-blockchain-receipt.md](./court-admissible-blockchain-receipt.md) |
| **Privacy Ledger Retention** | Data privacy and retention policies | [privacy-ledger-retention.md](./privacy-ledger-retention.md) |

## 👥 Operations

| Document | Description | Location |
|----------|-------------|----------|
| **Onboarding Operations** | User onboarding workflows | [onboarding-ops.md](./onboarding-ops.md) |
| **Monitoring** | Logging, metrics, and health checks | [operations/monitoring.md](./operations/monitoring.md) |

## 📋 Quick Reference

### Most Important Documents for New Developers
1. [Setup Checklist](./infrastructure/setup-checklist.md) - Start here
2. [Service Inventory](./services/service-inventory.md) - Understand the architecture
3. [Gateway API](./services/gateway-api/README.md) - Main backend service
4. [Docker Quick Reference](./infrastructure/docker-quick-ref.md) - Daily commands

### Most Important Documents for Operations
1. [Docker Setup](./infrastructure/docker-setup.md) - Infrastructure overview
2. [Service Verification](./services/service-verification.md) - Health monitoring
3. [Deployment Guide](./deployment.md) - Production procedures
4. [Analytics System](./analytics-system.md) - Public reporting

### Most Important Documents for Feature Development
1. [Image Submission System](./implementation/image-submission-system.md) - Latest feature implementation
2. [Core Domain](./services/core/README.md) - Business logic
3. [Testing Strategy](./testing-strategy.md) - Testing approach
4. [Implementation Summary](./implementation/implementation-summary.md) - Recent changes

## 📝 Documentation Standards

All documentation follows these standards:
- **Markdown format** with clear headings and structure
- **Code examples** with syntax highlighting
- **Step-by-step instructions** for setup and operations
- **Cross-references** between related documents
- **Version information** and last updated dates
- **Table of contents** for longer documents

## 🔄 Keeping Documentation Updated

When making changes to the system:
1. Update relevant service documentation
2. Update this index if adding new documents
3. Update the main [README.md](../README.md) if changing core features
4. Update setup guides if changing infrastructure
5. Update API documentation if changing endpoints

---

**Last Updated:** May 9, 2026  
**Total Documents:** 35+ comprehensive guides  
**Coverage:** Complete system documentation