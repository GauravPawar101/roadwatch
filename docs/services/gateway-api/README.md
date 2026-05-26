# Gateway API Service

## Overview
Central REST API service that serves as the main backend for the RoadWatch complaint management system. Built with Express.js and PostgreSQL, it handles authentication, complaint lifecycle management, analytics, and real-time updates. Database access goes through a shared `pg.Pool`, and the connection target should be the PgBouncer-backed Postgres endpoint.

## Architecture
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with 20+ tables
- **Authentication**: JWT-based with OTP verification
- **Real-time**: Server-Sent Events (SSE)
- **Event Streaming**: Kafka integration
- **File Storage**: Local disk (development) / Object storage (production)

## Key Features
- Multi-role authentication (CE, EE, CITIZEN)
- Complaint lifecycle management
- Real-time notifications via SSE
- Analytics and reporting
- Blockchain anchoring integration
- RTI (Right to Information) workflow
- LLM-powered agent endpoint

## API Routes

### Authentication (`/auth`)
- `POST /auth/send-otp` - Send OTP to phone number
- `POST /auth/verify-otp` - Verify OTP and get JWT token
- `POST /auth/refresh` - Refresh JWT token

### Citizen Routes (`/citizen`)
- `POST /citizen/complaints` - Submit new complaint with photo upload
- `GET /citizen/complaints` - List user's complaints
- `GET /citizen/complaints/:id` - Get complaint details
- `POST /citizen/complaints/:id/media` - Upload additional media

### Authority Routes (`/authority`)
- `GET /authority/complaints` - List complaints by jurisdiction
- `POST /authority/complaints/:id/status` - Update complaint status
- `POST /authority/complaints/:id/assign` - Assign to contractor
- `POST /authority/complaints/:id/escalate` - Escalate complaint
- `GET /authority/dashboard` - Authority dashboard data

### Public Routes (`/public`)
- `GET /public/dashboard` - Public analytics dashboard
- `GET /public/chronic-roads` - Long-pending complaints
- `GET /public/hotspots` - Spatial complaint clustering
- `GET /public/trends` - Worsening road trends
- `GET /public/contractors/scorecard` - Contractor performance
- `GET /public/export/roads.{csv,geojson,pdf}` - Data exports

### Admin Routes (`/admin`)
- `GET /admin/users` - User management
- `POST /admin/users` - Create user
- `GET /admin/analytics` - System analytics
- `POST /admin/seed` - Seed test data

### Reports (`/reports`)
- `GET /reports/ministry` - Ministry-level PDF reports
- `GET /reports/district/:id` - District-level PDF reports
- `GET /reports/contractor/:id` - Contractor performance reports

### RTI Routes (`/rti`)
- `POST /rti/requests` - Submit RTI request
- `GET /rti/requests/:token` - Get RTI status
- `POST /rti/requests/:id/respond` - Authority RTI response

### Notifications (`/notifications`)
- `GET /notifications` - User notification inbox
- `POST /notifications/mark-read` - Mark notifications as read
- `GET /notifications/preferences` - Get notification preferences
- `PUT /notifications/preferences` - Update notification preferences

### Real-time (`/events`)
- `GET /events` - SSE stream for real-time updates

## Data Models

### User
```typescript
type UserRow = {
  id: string;
  phone: string; // masked
  phoneHash: string;
  phoneEnc: string;
  phoneLast4: string;
  govtId: string;
  role: 'CE' | 'EE' | 'CITIZEN';
  districts: string[];
  zones: string[];
  created_at: Date;
};
```

### Complaint
```typescript
type Complaint = {
  id: string;
  district: string;
  zone: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
  description: string;
  lat: number;
  lng: number;
  created_at: Date;
  updated_at: Date;
  fabric_txid: string;
};
```

## Key Functions

### Authentication & Authorization
- `requireAuth()` - JWT token validation middleware
- `requireRole(roles)` - Role-based access control
- `assertDistrictAccess()` - District-level permissions
- `assertZoneAccess()` - Zone-level permissions

### Complaint Management
- `validateComplaintLocation()` - Ensure complaint is within 100m of road
- `generateComplaintId()` - Create unique complaint ID (RW-{DISTRICT}-{TIMESTAMP})
- `updateComplaintStatus()` - Status transition with validation
- `assignComplaintToContractor()` - Contractor assignment logic

### Analytics & Reporting
- `getChronicRoads()` - Find long-pending complaints
- `getHotspots()` - Spatial clustering analysis
- `getWorseningTrends()` - Trend analysis comparing time windows
- `getContractorScorecard()` - Performance metrics calculation
- `renderPublicRoadsPdf()` - PDF report generation

### Event Publishing
- `publishKafkaEvent()` - Publish events to Kafka with idempotency
- `broadcastComplaintEvent()` - Real-time SSE broadcasting
- `createAndFanoutNotification()` - Multi-channel notification dispatch

### Security
- `encryptPhone()` - Phone number encryption
- `hashPhone()` - Phone number hashing for indexing
- `maskPhone()` - Phone number masking for display
- `normalizePhone()` - Phone number normalization

## Database Schema

### Core Tables
- `users` - User accounts and roles
- `complaints` - Main complaint records
- `complaint_attachments` - Photo/video attachments
- `complaint_assignments` - Contractor assignments
- `complaint_merkle_proofs` - Blockchain anchoring data

### Geography
- `countries`, `states`, `districts` - Administrative boundaries
- `roads_catalog` - Road segments with geometry
- `road_assignments` - Road maintenance assignments

### Analytics
- `analytics_events` - Event stream for analytics
- `audit_log` - Immutable audit trail

### RTI System
- `rti_requests` - RTI applications
- `rti_responses` - RTI responses
- `rti_attachments` - RTI evidence files

### Notifications
- `notifications` - Notification records
- `notification_inbox` - User notification inbox
- `notification_deliveries` - Delivery tracking
- `notification_preferences` - User preferences

## Event Flow

### Complaint Submission Flow
1. Citizen submits complaint via `POST /citizen/complaints`
2. Validate location against road catalog
3. Insert complaint into PostgreSQL
4. Publish `complaint.submitted` event to Kafka
5. Return complaint ID to client
6. Fabric anchor consumer processes event asynchronously
7. Merkle root anchored to blockchain
8. `complaint.anchored` event published
9. Real-time update sent via SSE

### Status Update Flow
1. Authority updates status via `POST /authority/complaints/:id/status`
2. Validate authority permissions
3. Update complaint status in database
4. Insert audit log entry
5. Publish `complaint.status.changed` event
6. Trigger notifications to relevant users
7. Broadcast real-time update via SSE

## Configuration

### Environment Variables
- Database (PgBouncer-backed Postgres preferred):
- - `DATABASE_URL` - PostgreSQL connection string targeting the pooled endpoint
- - `POSTGRES_HOST` - PostgreSQL host
- - `POSTGRES_PORT` - PostgreSQL port
- - `POSTGRES_DB` - PostgreSQL database name
- - `POSTGRES_USER` - PostgreSQL user
- - `POSTGRES_PASSWORD` - PostgreSQL password
- `JWT_SECRET` - JWT signing secret
- `KAFKA_BROKERS` - Kafka broker list
- `GEMINI_API_KEY` - Google AI API key for agent
- `UPLOAD_ROOT` - File upload directory
- `PORT` - Server port (default: 3000)

### Database Connection
This project uses Postgres by default through `pg.Pool`. Example pool initialization:

```typescript
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
```

The primary runtime uses a pooled Postgres connection path. Any legacy migration helpers are historical only.

### Kafka Configuration
```typescript
const kafka = new KafkaJS({
  clientId: 'roadwatch-gateway-api',
  brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092']
});
```

## Error Handling
- Structured error responses with consistent format
- Request validation using Zod schemas
- Database transaction rollback on failures
- Kafka event retry logic with exponential backoff
- Graceful degradation for non-critical services

## Performance Considerations
- Database connection pooling
- Async event processing via Kafka
- Efficient spatial queries for location validation
- Pagination for large result sets
- Caching for frequently accessed data
- File upload size limits (15MB)

## Security Features
- Phone number encryption and hashing
- JWT token-based authentication
- Role-based access control (RBAC)
- Input validation and sanitization
- SQL injection prevention via parameterized queries
- File upload validation and virus scanning
- Rate limiting on sensitive endpoints