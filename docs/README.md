# RoadWatch Documentation

RoadWatch is a blockchain-enabled citizen complaint management platform for road infrastructure. This documentation reflects the **current** state of the monorepo.

## Quick links

| I want to… | Start here |
|------------|------------|
| Run the project locally | [Getting Started](./getting-started/setup.md) |
| Understand the system | [Architecture Overview](./architecture/overview.md) |
| Learn how complaints flow | [Complaint Lifecycle](./workflows/complaint-lifecycle.md) |
| Deploy to Docker or Kubernetes | [Deployment](./operations/deployment.md) |
| Find demo login credentials | [Test Credentials](./reference/test-credentials.md) |
| Look up ports and URLs | [Ports Reference](./reference/ports.md) |

## Documentation map

### Getting started
- [Prerequisites](./getting-started/prerequisites.md)
- [Setup](./getting-started/setup.md)
- [Environment variables](./getting-started/environment-variables.md)
- [Local development](./getting-started/local-development.md)

### Architecture
- [Overview](./architecture/overview.md)
- [Event pipeline](./architecture/event-pipeline.md)
- [Fabric network](./architecture/fabric-network.md)
- [Data model](./architecture/data-model.md)
- [Security and auth](./architecture/security-and-auth.md)
- [Kubernetes layers](./architecture/kubernetes.md)

### Services
- [Service index](./services/README.md)
- [Gateway API](./services/gateway-api.md)
- [Backend API](./services/backend-api.md)
- [Frontend](./services/frontend.md)
- [Mobile host](./services/mobile-host.md)
- [Fabric anchor consumer](./services/fabric-anchor-consumer.md)
- [Webhook handler](./services/webhook-handler.md)
- [Scheduler](./services/scheduler.md)
- [Media ingest](./services/media-ingest.md)
- [Shared packages](./services/shared-packages.md)

### Workflows
- [Workflow index](./workflows/README.md)
- [Complaint lifecycle](./workflows/complaint-lifecycle.md)
- [Blockchain anchoring](./workflows/blockchain-anchoring.md)
- [RTI (Right to Information)](./workflows/rti.md)
- [Authority portal](./workflows/authority-portal.md)
- [Citizen and contractor](./workflows/citizen-and-contractor.md)
- [Analytics and reporting](./workflows/analytics-and-reporting.md)
- [Notifications](./workflows/notifications.md)
- [AI agent](./workflows/ai-agent.md)

### Infrastructure
- [Infrastructure index](./infrastructure/README.md)
- [Docker Compose](./infrastructure/docker-compose.md)
- [Fabric deployment](./infrastructure/fabric-deployment.md)
- [Messaging (Kafka and Redis)](./infrastructure/messaging.md)
- [Database](./infrastructure/database.md)

### Development
- [Scripts and commands](./development/scripts-and-commands.md)
- [Testing](./development/testing.md)

### Operations
- [Deployment](./operations/deployment.md)
- [Seeding and onboarding](./operations/seeding-and-onboarding.md)
- [Monitoring](./operations/monitoring.md)
- [Troubleshooting](./operations/troubleshooting.md)

### Reference
- [Test credentials](./reference/test-credentials.md)
- [Ports](./reference/ports.md)
