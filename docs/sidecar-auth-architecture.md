# Sidecar Authentication Architecture

This document describes the sidecar authentication pattern implemented for the RoadWatch microservices architecture.

## Overview

The sidecar authentication pattern centralizes authentication and authorization through the gateway while allowing services to validate requests independently. This provides:

- **Centralized Authentication**: All user authentication happens at the gateway
- **Service Discovery**: Services register with the gateway for discovery
- **Secure Service-to-Service Communication**: JWT tokens for inter-service calls
- **User Context Propagation**: User information flows through service calls
- **Decentralized Authorization**: Services can enforce their own authorization rules

## Architecture Components

### 1. Gateway API (`apps/gateway-api`)

The gateway serves as the authentication and service discovery hub:

- **Authentication Routes** (`/auth`): Handle user login, OTP, token refresh
- **Service Registry** (`/services`): Service registration and discovery
- **Proxy Routes** (`/proxy`): Route authenticated requests to services
- **Service Token Issuance**: Generate short-lived service access tokens

### 2. Sidecar Auth Package (`packages/sidecar-auth`)

Provides middleware and client utilities for services:

- **Authentication Middleware**: Validate service tokens and extract user context
- **Service Client**: Register with gateway and make authenticated service calls
- **Role-based Authorization**: Middleware for role and permission checks

### 3. Service Integration

Services integrate the sidecar pattern by:

- Registering with the gateway on startup
- Using sidecar middleware to validate incoming requests
- Making authenticated calls to other services through the gateway

## Authentication Flow

### User Authentication Flow

```
1. User → Gateway: Login request (phone/OTP or password)
2. Gateway → User: JWT access token + refresh token
3. User → Gateway: API request with Bearer token
4. Gateway: Validates user token, extracts user context
5. Gateway → Service: Proxied request with service token + user headers
6. Service: Validates service token, extracts user context
7. Service → Gateway → User: Response
```

### Service-to-Service Flow

```
1. Service A → Gateway: Request service token for Service B
2. Gateway: Validates Service A registration, issues access token
3. Service A → Service B: Direct call with service access token
4. Service B: Validates service token from Gateway
5. Service B → Service A: Response
```

## Implementation Guide

### 1. Service Registration

Services register with the gateway on startup:

```typescript
import { SidecarAuthClient } from '@roadwatch/sidecar-auth';

const sidecarClient = new SidecarAuthClient(gatewayUrl, serviceName);

// Register service
const result = await sidecarClient.registerService({
  name: 'my-service',
  address: 'http://localhost:4001',
  healthUrl: 'http://localhost:4001/health',
  description: 'My microservice',
  metadata: { version: '1.0.0' }
});

console.log('Registration token:', result.registrationToken);
```

### 2. Service Authentication Middleware

Apply sidecar authentication to protected routes:

```typescript
import { sidecarAuth, requireUserContext, requireUserRole } from '@roadwatch/sidecar-auth';

// Apply to all routes
app.use('/api', sidecarAuth, apiRouter);

// Require user context
router.get('/profile', requireUserContext, (req, res) => {
  const { userContext } = req;
  res.json({ userId: userContext.id, role: userContext.role });
});

// Require specific roles
router.get('/admin', requireUserRole(['CE', 'EE']), (req, res) => {
  res.json({ message: 'Admin access granted' });
});
```

### 3. Service-to-Service Calls

Make authenticated calls to other services:

```typescript
// Get service info and token
const response = await sidecarClient.callService('backend-api', {
  method: 'POST',
  path: '/complaints',
  body: { title: 'Road issue', description: 'Pothole on main street' }
});

const result = await response.json();
```

### 4. Gateway Proxy Usage

Users can access services through the gateway proxy:

```bash
# User authenticates with gateway
curl -X POST http://gateway/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone": "+1234567890", "password": "secret"}'

# Use token to access service through proxy
curl -X GET http://gateway/proxy/backend-api/complaints \
  -H "Authorization: Bearer <user-token>"
```

## Security Features

### JWT Token Types

1. **User Access Tokens**: Issued to users for API access (15 min default)
2. **User Refresh Tokens**: Long-lived tokens for token renewal (7 days default)
3. **Service Registration Tokens**: Long-lived tokens for service registry access (24h default)
4. **Service Access Tokens**: Short-lived tokens for service-to-service calls (5 min default)

### Token Validation

- **Audience Validation**: Tokens are scoped to specific services
- **Issuer Validation**: All tokens must be issued by the gateway
- **Expiration**: Short-lived tokens minimize exposure
- **Method/Path Scoping**: Service tokens can be scoped to specific endpoints

### User Context Propagation

User information is securely propagated through headers:

- `X-User-ID`: User identifier
- `X-User-Role`: User role (CITIZEN, CE, EE, CONTRACTOR)
- `X-User-Phone`: Masked phone number
- `X-User-Phone-Hash`: Phone hash for correlation
- `X-User-Districts`: JSON array of user's districts
- `X-User-Zones`: JSON array of user's zones

## Configuration

### Environment Variables

**Gateway API:**
```bash
SERVICE_AUTH_SECRET=your-service-secret
SERVICE_REGISTRY_SECRET=optional-registry-secret
ACCESS_SECRET=user-token-secret
REFRESH_SECRET=refresh-token-secret
```

**Services:**
```bash
SERVICE_NAME=my-service
SERVICE_URL=http://localhost:4001
GATEWAY_URL=http://localhost:3100
SERVICE_AUTH_SECRET=same-as-gateway
```

### Service Discovery

Services are automatically discovered through the registry:

```typescript
// List all services
const services = await fetch('/services', {
  headers: { Authorization: `Bearer ${registrationToken}` }
});

// Get specific service
const service = await fetch('/services/backend-api', {
  headers: { Authorization: `Bearer ${registrationToken}` }
});
```

## Error Handling

The sidecar auth middleware provides detailed error codes:

- `MISSING_SERVICE_TOKEN`: No Authorization header
- `INVALID_SERVICE_TOKEN`: Token validation failed
- `SERVICE_TOKEN_EXPIRED`: Token has expired
- `INVALID_SERVICE_SCOPE`: Token not valid for this service
- `METHOD_NOT_ALLOWED`: Token not valid for this HTTP method
- `PATH_NOT_ALLOWED`: Token not valid for this path
- `MISSING_USER_CONTEXT`: User context required but not provided
- `INSUFFICIENT_ROLE`: User role not sufficient for this endpoint

## Monitoring and Health Checks

### Service Health

Services report health through standard endpoints:

- `/health`: Basic health check
- `/health/db`: Database connectivity check

### Gateway Health

The gateway provides comprehensive health monitoring:

- `/health`: Basic gateway health
- `/health/status`: System-wide health report
- `/health/services`: Service dependency graph

## Best Practices

1. **Token Expiration**: Use short-lived service tokens (5-15 minutes)
2. **Error Handling**: Implement proper error handling for token validation
3. **Health Checks**: Implement comprehensive health checks
4. **Logging**: Log authentication events for audit trails
5. **Secrets Management**: Use environment variables for secrets
6. **Service Discovery**: Always use service discovery rather than hardcoded URLs
7. **Graceful Degradation**: Handle gateway unavailability gracefully

## Migration Guide

To migrate existing services to the sidecar pattern:

1. **Install Package**: Add `@roadwatch/sidecar-auth` dependency
2. **Update Middleware**: Replace existing JWT middleware with sidecar auth
3. **Service Registration**: Add service registration on startup
4. **Update Service Calls**: Use sidecar client for inter-service communication
5. **Test Integration**: Verify authentication and authorization work correctly

## Troubleshooting

### Common Issues

1. **Service Registration Fails**: Check gateway URL and network connectivity
2. **Token Validation Fails**: Verify SERVICE_AUTH_SECRET matches between gateway and service
3. **User Context Missing**: Ensure requests go through gateway proxy or include user headers
4. **Role Authorization Fails**: Check user role matches required roles in middleware

### Debug Tips

1. Enable debug logging in services
2. Check gateway logs for service registration events
3. Verify token contents using JWT debugger tools
4. Test service-to-service calls independently
5. Monitor health check endpoints