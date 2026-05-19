# Image Submission & Verification System

Complete implementation of geotagged image submissions with anti-stale verification, privacy enforcement, and karma-based fraud detection for the RoadWatch platform.

## Overview

This system ensures that:

1. **Images are current (not stale)** - Server nonces & timestamps prevent old image reuse
2. **Images are geotagged & located correctly** - EXIF GPS + device GPS + geofence validation
3. **User privacy is protected** - User IDs encrypted at rest, role-based field visibility
4. **Fraud is detected & penalized** - Perceptual hashing, duplicate detection, karma scoring
5. **Audit trail is immutable** - All access & verification checks logged for compliance

## Features

### 1. Anti-Stale Upload (Nonce + Timestamp Verification)

- **Server Nonce Generation**: POST `/submissions/nonce` returns a short-lived nonce (5 min TTL)
- **Nonce Overlay**: Client renders nonce + timestamp as watermark on camera preview (prevents reuse)
- **Validation**: Server verifies nonce matches request and hasn't expired
- **Rate Limiting**: Max 10 nonce requests per minute per user

**Example Flow:**
```
1. Client requests nonce → Server issues nonce + expiry
2. Client opens camera, overlays nonce + time on preview
3. User takes photo (nonce rendered into image)
4. Client uploads image with nonce + EXIF timestamp
5. Server validates nonce fresh AND image timestamp within 10 min window
```

### 2. Geolocation Verification

- **Dual GPS**: Uses EXIF GPS + device GPS (device preferred, EXIF fallback)
- **Geofence Validation**: Haversine distance formula checks image location is within 50m of expected coordinates
- **Error Messages**: Clear feedback if outside bounds

### 3. Duplicate Detection (Perceptual Hashing)

- **pHash Calculation**: Generates perceptual hash of image to detect visual similarity
- **Hamming Distance**: Compares against recent images; distance ≤ 10 = likely duplicate
- **Flagging**: Duplicate images flagged for review; penalty applied if confirmed
- **Lookback**: Checks 60 minutes of recent submissions

### 4. Privacy & RBAC

**Role-Based Field Visibility:**

| Field | Admin | Authority | Contractor | Citizen |
|-------|-------|-----------|-----------|---------|
| `uploader_id_encrypted` | ✅ | ❌ | ❌ | ✅ (own) |
| `uploader_pseudonym` | ✅ | ❌ | ❌ | ✅ (own) |
| `exif_latitude / longitude` | ✅ | ✅ | ✅ | ✅ (own) |
| `device_latitude / longitude` | ✅ | ❌ | ❌ | ✅ (own) |
| `nonce` | ✅ | ❌ | ❌ | ✅ (own) |
| `verified_status` | ✅ | ✅ | ✅ | ✅ (own) |
| `storage_path` | ✅ | ✅ | ✅ | ✅ (own) |
| `request_id` | ✅ | ✅ | ✅ | ✅ (own) |
| `server_received_at` | ✅ | ✅ | ✅ | ✅ (own) |

**Key Rules:**
- **Admin**: Full visibility (can decrypt user IDs)
- **Authority/Contractor**: Can see location & metadata, NOT user IDs (no identifying fields)
- **Citizens**: Can only view their own submissions
- **All access is logged** for compliance audits

### 5. Karma System

**Karma Tiers:**
- **Trusted** (500+): Low-friction submissions, trusted user
- **Standard** (100-499): Normal users, balanced review
- **AtRisk** (0-99): Increased scrutiny, pending review
- **Suspended** (-100 or 2nd penalty): Temporary ban (7 days)
- **Banned** (3+ penalties): Permanent ban

**Karma Transactions:**
- **Valid Submission**: +10 bonus → `Verified` status
- **Flagged Submission**: -50 penalty → `Flagged` for manual review
- **Duplicate Image**: -30 penalty → automatic flag
- **Rejected Image**: -75 penalty → most severe
- **Appeal Approved**: +30 restoration

**Escalation Policy:**
- 1st offense: Warning only
- 2nd offense: -50 karma + 7-day suspension
- 3rd offense: Permanent ban + display reason

**Daily Limits:**
- Citizens limited to 10 submissions per day
- Resets at midnight UTC

### 6. Audit & Compliance Logging

**Immutable Audit Trail:**

Every submission logged with:
- ✅ Verification check results (timestamp, geofence, nonce, phash, etc.)
- ✅ User who reviewed (if manual review)
- ✅ Admin access to user IDs (when decrypted)
- ✅ Field-level access logs (who read what)
- ✅ All penalties applied with reason

**Access Control Logs:**
```
{
  user_id: "admin-1",
  resource_type: "image_submission",
  resource_id: "sub-123",
  action: "read",
  accessed_fields: ["id", "request_id", "uploader_id_encrypted"],
  status: "Success",
  created_at: 1715341234567
}
```

## Database Schema

### Tables

**image_submissions**
```sql
- id: UUID (PK)
- request_id: VARCHAR (work request)
- uploader_id_encrypted: BYTEA (encrypted user ID)
- uploader_pseudonym: VARCHAR (Citizen#ABC123)
- server_received_at: BIGINT (server timestamp)
- exif_timestamp, exif_latitude, exif_longitude
- device_latitude, device_longitude
- nonce: VARCHAR (verification token)
- phash: VARCHAR (perceptual hash)
- verified_status: ENUM (Pending/Verified/Flagged/Rejected)
- storage_path: TEXT (blob storage location)
- metadata: JSONB (check_results, geofence_radius, etc.)
- fabric_tx_id: VARCHAR (Fabric ledger tx for immutability)
```

**karma_records**
```sql
- user_id: VARCHAR (PK)
- score: INT (-500 to 10000)
- tier: ENUM (Trusted/Standard/AtRisk/Suspended/Banned)
- penalty_count: INT (escalation counter)
- last_penalty_at, suspended_until: BIGINT
- ban_reason: TEXT
- daily_submission_count, last_submission_date
```

**verification_audits** (immutable)
```sql
- submission_id: UUID (FK)
- check_type: ENUM (exif_time/geofence/phash/nonce/manual_review/duplicate/tamper_detection)
- check_result: BOOLEAN
- detail: JSONB
- reviewer_id, action, reason
```

**karma_appeals**
```sql
- user_id, submission_id (FK)
- reason: TEXT
- status: ENUM (Pending/Approved/Rejected/Withdrawn)
- reviewer_id, decision, decided_at
```

**user_privacy_profiles**
```sql
- user_id: VARCHAR (PK)
- is_admin, is_authority, is_contractor, is_citizen: BOOLEAN
- authority_jurisdiction: JSONB (area codes)
- can_view_user_ids: BOOLEAN
```

**access_logs** (compliance audit)
```sql
- user_id, resource_type, resource_id, action
- accessed_fields: JSONB
- ip_address: INET
- status: ENUM (Success/Denied/Error)
- reason_blocked: TEXT
```

**server_nonces**
```sql
- nonce: VARCHAR (UNIQUE)
- user_id, request_id
- issued_at, expires_at: BIGINT
- used: BOOLEAN
- used_at: BIGINT
```

## API Endpoints

### Nonce Management

**POST /submissions/nonce**
```json
Request:
{
  "request_id": "req-123",
  "ttl_seconds": 300
}

Response (201):
{
  "nonce": "a1b2c3d4...",
  "issued_at": 1715341234567,
  "expires_at": 1715341534567,
  "ttl_seconds": 300
}
```

### Image Submission

**POST /submissions**
```
Content-Type: application/octet-stream
Authorization: Bearer <jwt_token>

Query Params:
- request_id=req-123
- nonce=a1b2c3d4...
- exif_timestamp=1715341200000
- exif_latitude=28.7041
- exif_longitude=77.1025
- device_latitude=28.7041
- device_longitude=77.1025
- geofence_latitude=28.7041
- geofence_longitude=77.1025
- geofence_radius_meters=50

Response (201):
{
  "id": "sub-456",
  "request_id": "req-123",
  "uploader_pseudonym": "Citizen#A1B2C3",
  "verified_status": "Verified",
  "server_received_at": 1715341234567,
  "check_results": [
    {
      "name": "exif_time_validation",
      "passed": true,
      "detail": "Timestamp valid: 45ms difference"
    },
    {
      "name": "geofence_validation",
      "passed": true,
      "detail": "Within geofence: 12.5m from center"
    }
  ],
  "warnings": [],
  "message": "Image verified successfully"
}
```

### Submission Retrieval

**GET /submissions/:id**
```json
Response (200):
{
  "id": "sub-456",
  "request_id": "req-123",
  "uploader_pseudonym": "Citizen#A1B2C3",  // hidden if not admin/owner
  "server_received_at": 1715341234567,
  "exif_latitude": 28.7041,
  "exif_longitude": 77.1025,
  "verified_status": "Verified",
  "storage_path": "/submissions/sub-456.jpg"
}
```

**GET /submissions?request_id=req-123&status=Verified&limit=50&offset=0**
```json
Response (200):
{
  "data": [{ ...submissions... }],
  "count": 5,
  "limit": 50,
  "offset": 0
}
```

### Karma Endpoints

**GET /karma/:userId**
```json
Response (200):
{
  "user_id": "user-123",
  "score": 145,
  "tier": "Standard",
  "penalty_count": 0,
  "suspended_until": 0,
  "daily_submission_count": 2,
  "last_submission_date": "2025-05-08"
}
```

**GET /karma/leaderboard?tier=Trusted&limit=100&offset=0**
```json
Response (200):
{
  "data": [
    {
      "tier": "Trusted",
      "score": 850,
      "rank": 1
    }
  ],
  "count": 42
}
```

## Error Handling

### Verification Failures

**Stale Image** (410 Gone)
```json
{
  "error": "Image is too old (outside time window)",
  "verified_status": "Flagged"
}
```

**Outside Geofence** (422 Unprocessable Entity)
```json
{
  "error": "Image location is outside allowed geofence",
  "distance_m": 2400.5,
  "geofence_radius_m": 50
}
```

**Invalid/Expired Nonce** (400 Bad Request)
```json
{
  "error": "Nonce expired",
  "time_remaining_ms": 0
}
```

### Privacy Violations

**Unauthorized Access** (403 Forbidden)
```json
{
  "error": "Field 'uploader_id_encrypted' is not accessible to role 'authority'"
}
```

**Citizen Cannot View Others** (403 Forbidden)
```json
{
  "error": "Citizens can only view their own submissions"
}
```

## Implementation Checklist

- [x] Database migrations (schema)
- [x] TypeScript types and interfaces
- [x] Verification service (EXIF, geofence, nonce, phash)
- [x] Karma system (scoring, tiers, escalation)
- [x] Privacy service (RBAC, field filtering)
- [x] Nonce service (generation, validation)
- [x] Database helpers (CRUD operations)
- [x] API routes (submission, retrieval, karma)
- [x] RBAC middleware
- [x] Integration tests
- [ ] Client SDK (mobile camera overlay + nonce request)
- [ ] Admin dashboard (verification queue, appeals)
- [ ] Elasticsearch indexing (for fraud detection analytics)
- [ ] Background jobs (nonce cleanup, karma decay)

## Client Implementation Guide

### 1. Request Nonce (Before Camera)
```typescript
const nonceResponse = await fetch('/submissions/nonce', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ request_id })
});
const { nonce, expires_at } = await nonceResponse.json();
```

### 2. Capture with Overlay
```typescript
// Render on camera preview:
const overlayText = `[Verified ${new Date().toISOString()}]\n[Nonce: ${nonce.substring(0, 8)}]`;
// Draw text at bottom of camera frame before capturing
```

### 3. Submit with Verification Data
```typescript
const formData = new FormData();
formData.append('image', imageBlob);

const searchParams = new URLSearchParams({
  request_id,
  nonce,
  exif_timestamp: exifData.timestamp,
  exif_latitude: exifData.latitude,
  exif_longitude: exifData.longitude,
  device_latitude: deviceLocation.latitude,
  device_longitude: deviceLocation.longitude,
  geofence_latitude: expectedLocation.latitude,
  geofence_longitude: expectedLocation.longitude,
  geofence_radius_meters: '50'
});

const response = await fetch(`/submissions?${searchParams}`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: imageBlob
});
```

## Conflict Resolution

### No Package Conflicts
- Uses standard npm packages: `pg` (PostgreSQL), `crypto` (Node.js built-in)
- No conflicts with existing dependencies

### No Schema Conflicts
- New tables are isolated: `image_submissions`, `karma_records`, `verification_audits`, etc.
- Migrations use explicit version numbers: `001_`, `002_`, `003_`
- Existing tables unchanged

### No Route Conflicts
- New routes namespaced: `/submissions`, `/karma`
- Separate from complaints, escalations, etc.

### No Type Conflicts
- New types in `@packages/core/src/image-types.ts`
- Exported separately; no naming collisions

## Testing

Run integration tests:
```bash
cd packages/core
npm run test -- image-submission.test.ts
```

Manual API test:
```bash
# Generate nonce
curl -X POST http://localhost:3100/submissions/nonce \
  -H "Authorization: Bearer <token>" \
  -d '{"request_id": "req-123"}'

# Submit image
curl -X POST "http://localhost:3100/submissions?request_id=req-123&nonce=..." \
  -H "Authorization: Bearer <token>" \
  --data-binary @image.jpg
```

## Configuration

Environment variables (in `.env`):
```env
# Verification settings
VERIFICATION_TIME_WINDOW_MS=600000
VERIFICATION_GEOFENCE_RADIUS_M=50
VERIFICATION_NONCE_TTL_SECONDS=300
VERIFICATION_PHASH_THRESHOLD=10

# Karma settings
KARMA_INITIAL_SCORE=100
KARMA_VALID_BONUS=10
KARMA_FLAGGED_PENALTY=-50
KARMA_DUPLICATE_PENALTY=-30
KARMA_REJECTED_PENALTY=-75
KARMA_DAILY_LIMIT=10

# Database (Cassandra preferred)
CASSANDRA_CONTACT_POINTS=cassandra:9042
CASSANDRA_KEYSPACE=roadwatch
CASSANDRA_LOCAL_DC=datacenter1
```

## Future Enhancements

1. **ML Tamper Detection**: Detect edited/composite images via ML model
2. **Blockchain Ledger**: Store image hash on Hyperledger Fabric for immutability
3. **Mobile SDKs**: React Native + Flutter with built-in nonce overlay
4. **Admin Dashboard**: Verification queue, appeal management, analytics
5. **Elasticsearch**: Index submissions for fraud pattern detection
6. **Time-Series Analytics**: Track karma scores, detect bot networks
7. **Multi-Modal Verification**: Compare audio + video + images
8. **Geographic Heat Maps**: Identify suspicious submission clusters

## References

- Haversine Formula: https://en.wikipedia.org/wiki/Haversine_formula
- EXIF Data: https://en.wikipedia.org/wiki/Exif
- Perceptual Hashing: https://www.hackerfactor.com/papers/phash.html
- OWASP RBAC: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
