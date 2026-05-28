# Chaincode Service (Hyperledger Fabric Smart Contract)

## Overview
TypeScript-based smart contract for Hyperledger Fabric that manages complaint lifecycle on the blockchain. Provides immutable audit trails, privacy-preserving data storage, and cryptographic proof of complaint integrity.

## Architecture
- **Language**: TypeScript (compiled to JavaScript)
- **Framework**: Fabric Contract API
- **Blockchain**: Hyperledger Fabric 2.x
- **Privacy**: Private Data Collections for PII
- **Consensus**: Practical Byzantine Fault Tolerance (PBFT)
- **State Database**: CouchDB for rich queries

## Key Features
- Immutable complaint records
- Privacy-preserving PII storage
- Merkle root anchoring for batch verification
- Multi-organization endorsement
- Rich query support
- Audit trail generation

## Smart Contract Functions

### Complaint Management
```typescript
/**
 * Create a new complaint on the ledger
 * @param ctx - Transaction context
 * @param id - Unique complaint identifier
 * @param citizenId - Citizen identifier (stored in private collection)
 * @param roadId - Road identifier
 * @param location - Geographic location (stored in private collection)
 * @param initialIPFSCid - IPFS content identifier for media
 * @param authorityOrg - Responsible authority organization
 * @param detailsHash - Hash of complaint details
 */
public async CreateComplaint(
  ctx: Context,
  id: string,
  citizenId: string,
  roadId: string,
  location: string,
  initialIPFSCid: string,
  authorityOrg: string,
  detailsHash?: string
): Promise<void>
```

```typescript
/**
 * Update complaint status (Authority MSPs only)
 * @param ctx - Transaction context
 * @param id - Complaint identifier
 * @param newStatus - New status (PENDING, IN_PROGRESS, RESOLVED, REJECTED)
 * @param notes - Optional status update notes
 */
public async UpdateComplaintStatus(
  ctx: Context,
  id: string,
  newStatus: string,
  notes?: string
): Promise<void>
```

```typescript
/**
 * Resolve complaint with evidence (Authority MSPs only)
 * @param ctx - Transaction context
 * @param id - Complaint identifier
 * @param evidenceCid - IPFS CID of resolution evidence
 * @param resolutionNotes - Resolution description
 */
public async ResolveComplaint(
  ctx: Context,
  id: string,
  evidenceCid: string,
  resolutionNotes: string
): Promise<void>
```

### Batch Anchoring
```typescript
/**
 * Anchor Merkle root for batch of complaints
 * @param ctx - Transaction context
 * @param batchId - Unique batch identifier
 * @param merkleRoot - Merkle tree root hash
 * @param count - Number of complaints in batch
 */
public async SubmitMerkleRoot(
  ctx: Context,
  merkleRoot: string,
  regionCode: string,
  batchSize: string
): Promise<void>
```

### Query Functions
```typescript
/**
 * Get complaint by ID
 * @param ctx - Transaction context
 * @param id - Complaint identifier
 * @returns Complaint object
 */
public async GetComplaint(ctx: Context, id: string): Promise<string>

/**
 * Get complaint history (all transactions)
 * @param ctx - Transaction context
 * @param id - Complaint identifier
 * @returns Array of historical states
 */
public async GetComplaintHistory(ctx: Context, id: string): Promise<string>

/**
 * Query complaints by road ID
 * @param ctx - Transaction context
 * @param roadId - Road identifier
 * @returns Array of complaints for the road
 */
public async QueryComplaintsByRoad(ctx: Context, roadId: string): Promise<string>

/**
 * Query pending complaints by authority
 * @param ctx - Transaction context
 * @param authorityOrg - Authority organization
 * @returns Array of pending complaints
 */
public async QueryPendingComplaintsByAuthority(ctx: Context, authorityOrg: string): Promise<string>
```

## Data Models

### Complaint (Public Ledger)
```typescript
interface Complaint {
  ID: string;                    // Unique complaint identifier
  RoadID: string;               // Associated road identifier
  DetailsHash: string;          // Hash of complaint details
  Status: ComplaintStatus;      // Current status
  AuthorityOrg: string;        // Responsible authority
  CreatedAt: number;           // Creation timestamp
  UpdatedAt: number;           // Last update timestamp
}

enum ComplaintStatus {
  FILED = 'FILED',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED'
}
```

### ComplaintPII (Private Data Collection)
```typescript
interface ComplaintPII {
  CitizenID?: string;          // Citizen identifier (encrypted)
  Location?: string;           // Geographic coordinates
  InitialIPFSCid?: string;     // IPFS content identifier
}
```

### MerkleAnchorBatch
```typescript
interface MerkleAnchorBatch {
  ID: string;                  // Batch identifier
  MerkleRoot: string;          // Merkle tree root hash
  Count: number;               // Number of items in batch
  CreatedAt: number;           // Batch creation timestamp
}
```

## Access Control & Permissions

### MSP-Based Authorization
```typescript
// Citizen organization can create complaints
const allowedCitizenMsps = (process.env.ALLOWED_CITIZEN_MSPS ?? 'CitizenOrgMSP')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Authority organizations can update complaints
const allowedAuthorityMsps = (process.env.ALLOWED_AUTHORITY_MSPS ?? 'AuthorityOrgMSP')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
```

### Permission Validation
```typescript
private validateCitizenAccess(ctx: Context): void {
  const mspId = ctx.clientIdentity.getMSPID();
  if (!this.allowedCitizenMsps.includes(mspId)) {
    throw new Error(`MSP ${mspId} is not authorized for citizen operations.`);
  }
}

private validateAuthorityAccess(ctx: Context): void {
  const mspId = ctx.clientIdentity.getMSPID();
  if (!this.allowedAuthorityMsps.includes(mspId)) {
    throw new Error(`MSP ${mspId} is not authorized for authority operations.`);
  }
}
```

## Privacy Model

### Private Data Collections
- **citizenPIICollection**: Stores sensitive citizen data
  - Only accessible by CitizenOrgMSP
  - Automatic purging after configurable period
  - Encrypted at rest

### Transient Data Usage
```typescript
// PII passed via transient data (not written to ledger)
const transient = ctx.stub.getTransient();
const transientPii = transient.get('pii');

if (transientPii && transientPii.length > 0) {
  const pii = JSON.parse(Buffer.from(transientPii).toString('utf8')) as ComplaintPII;
  await ctx.stub.putPrivateData('citizenPIICollection', id, Buffer.from(JSON.stringify(pii)));
}
```

## Rich Queries (CouchDB)

### Query by Road ID
```typescript
const queryString = JSON.stringify({
  selector: {
    RoadID: roadId
  },
  sort: [{ CreatedAt: 'desc' }]
});

const iterator = await ctx.stub.getQueryResult(queryString);
```

### Query Pending Complaints
```typescript
const queryString = JSON.stringify({
  selector: {
    AuthorityOrg: authorityOrg,
    Status: { $in: ['FILED', 'IN_PROGRESS'] }
  },
  sort: [{ CreatedAt: 'asc' }]
});
```

## Event Emission

### Complaint Events
```typescript
// Emit event for off-chain listeners
ctx.stub.setEvent('ComplaintCreated', Buffer.from(JSON.stringify({
  complaintId: id,
  roadId: roadId,
  authorityOrg: authorityOrg,
  timestamp: now
})));

ctx.stub.setEvent('ComplaintStatusChanged', Buffer.from(JSON.stringify({
  complaintId: id,
  oldStatus: complaint.Status,
  newStatus: newStatus,
  timestamp: Date.now()
})));
```

## Deployment Configuration

### Chaincode Package
```json
{
  "name": "roadwatch-chaincode",
  "version": "1.0.0",
  "type": "node",
  "label": "roadwatch-chaincode-1.0.0"
}
```

### Collection Configuration
```json
[
  {
    "name": "citizenPIICollection",
    "policy": "OR('CitizenOrgMSP.member')",
    "requiredPeerCount": 1,
    "maxPeerCount": 3,
    "blockToLive": 1000000,
    "memberOnlyRead": true,
    "memberOnlyWrite": true,
    "endorsementPolicy": {
      "signaturePolicy": "OR('CitizenOrgMSP.member')"
    }
  }
]
```

### Endorsement Policy
```json
{
  "identities": [
    {
      "principal": {
        "mspIdentifier": "CitizenOrgMSP",
        "role": "MEMBER"
      }
    },
    {
      "principal": {
        "mspIdentifier": "AuthorityOrgMSP",
        "role": "MEMBER"
      }
    }
  ],
  "policy": {
    "1-of": [
      { "signed-by": 0 },
      { "signed-by": 1 }
    ]
  }
}
```

## Error Handling

### Validation Errors
```typescript
// Input validation
if (!id || id.trim().length === 0) {
  throw new Error('Complaint ID cannot be empty');
}

if (!roadId || roadId.trim().length === 0) {
  throw new Error('Road ID cannot be empty');
}

// Existence checks
const exists = await ctx.stub.getState(id);
if (exists && exists.length > 0) {
  throw new Error(`Complaint with ID ${id} already exists`);
}
```

### Authorization Errors
```typescript
const mspId = ctx.clientIdentity.getMSPID();
if (!allowedMsps.includes(mspId)) {
  throw new Error(`MSP ${mspId} is not authorized for this operation`);
}
```

## Performance Considerations
- Efficient state queries using CouchDB indexes
- Batch processing for multiple operations
- Minimal data storage on public ledger
- Private data collection for PII isolation
- Event-driven architecture for off-chain processing

## Security Features
- MSP-based access control
- Private data collections for sensitive information
- Cryptographic hashing for data integrity
- Immutable audit trails
- Endorsement policy enforcement
- Transaction-level authentication

## Monitoring & Logging
- Transaction success/failure events
- Performance metrics collection
- Error logging and alerting
- Audit trail generation
- Compliance reporting

## Upgrade Strategy
- Semantic versioning for chaincode releases
- Backward compatibility maintenance
- Migration scripts for data transformation
- Rollback procedures for failed upgrades
- Testing in isolated environments before production deployment