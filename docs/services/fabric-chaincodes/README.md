# Fabric Chaincodes (Go Implementation)

## Overview
Additional Hyperledger Fabric smart contracts written in Go that provide specialized registry and routing functionality for the RoadWatch system. These complement the main TypeScript chaincode with domain-specific operations.

## Architecture
- **Language**: Go
- **Framework**: Hyperledger Fabric Contract API (Go)
- **Deployment**: Separate chaincode packages
- **Integration**: Called by main complaint-anchor chaincode
- **State Database**: CouchDB for rich queries

## Chaincode Services

### Authority Registry (`fabric/chaincode/authority-registry`)
Manages authority organization data and hierarchies on the blockchain.

#### Key Functions
```go
// RegisterAuthority registers a new authority organization
func (s *SmartContract) RegisterAuthority(
    ctx contractapi.TransactionContextInterface,
    authorityId string,
    name string,
    authorityType string,
    jurisdiction string,
    parentAuthorityId string,
) error

// GetAuthority retrieves authority information
func (s *SmartContract) GetAuthority(
    ctx contractapi.TransactionContextInterface,
    authorityId string,
) (*Authority, error)

// UpdateAuthorityStatus updates authority operational status
func (s *SmartContract) UpdateAuthorityStatus(
    ctx contractapi.TransactionContextInterface,
    authorityId string,
    status string,
) error

// GetAuthoritiesByJurisdiction queries authorities by geographic area
func (s *SmartContract) GetAuthoritiesByJurisdiction(
    ctx contractapi.TransactionContextInterface,
    jurisdiction string,
) ([]*Authority, error)
```

#### Data Model
```go
type Authority struct {
    ID           string `json:"id"`
    Name         string `json:"name"`
    Type         string `json:"type"` // NHAI, PWD, LOCAL
    Jurisdiction string `json:"jurisdiction"`
    ParentID     string `json:"parentId"`
    Status       string `json:"status"` // ACTIVE, INACTIVE
    CreatedAt    int64  `json:"createdAt"`
    UpdatedAt    int64  `json:"updatedAt"`
}
```

### Budget Registry (`fabric/chaincode/budget-registry`)
Tracks budget allocations and expenditures for road maintenance projects.

#### Key Functions
```go
// AllocateBudget creates a new budget allocation
func (s *SmartContract) AllocateBudget(
    ctx contractapi.TransactionContextInterface,
    allocationId string,
    authorityId string,
    amount string,
    fiscalYear string,
    category string,
) error

// RecordExpenditure records budget spending
func (s *SmartContract) RecordExpenditure(
    ctx contractapi.TransactionContextInterface,
    expenditureId string,
    allocationId string,
    amount string,
    description string,
    contractorId string,
) error

// GetBudgetStatus retrieves current budget status
func (s *SmartContract) GetBudgetStatus(
    ctx contractapi.TransactionContextInterface,
    allocationId string,
) (*BudgetAllocation, error)
```

#### Data Model
```go
type BudgetAllocation struct {
    ID          string `json:"id"`
    AuthorityID string `json:"authorityId"`
    Amount      string `json:"amount"`
    Spent       string `json:"spent"`
    Remaining   string `json:"remaining"`
    FiscalYear  string `json:"fiscalYear"`
    Category    string `json:"category"` // MAINTENANCE, CONSTRUCTION, EMERGENCY
    Status      string `json:"status"`   // ACTIVE, EXHAUSTED, FROZEN
    CreatedAt   int64  `json:"createdAt"`
}

type Expenditure struct {
    ID           string `json:"id"`
    AllocationID string `json:"allocationId"`
    Amount       string `json:"amount"`
    Description  string `json:"description"`
    ContractorID string `json:"contractorId"`
    Timestamp    int64  `json:"timestamp"`
}
```

### Road Registry (`fabric/chaincode/road-registry`)
Maintains comprehensive road infrastructure data and maintenance history.

#### Key Functions
```go
// RegisterRoad adds a new road to the registry
func (s *SmartContract) RegisterRoad(
    ctx contractapi.TransactionContextInterface,
    roadId string,
    name string,
    roadType string,
    authorityId string,
    geometry string,
) error

// UpdateRoadCondition records road condition assessment
func (s *SmartContract) UpdateRoadCondition(
    ctx contractapi.TransactionContextInterface,
    roadId string,
    condition string,
    assessmentDate string,
    inspectorId string,
) error

// GetRoadHistory retrieves complete road maintenance history
func (s *SmartContract) GetRoadHistory(
    ctx contractapi.TransactionContextInterface,
    roadId string,
) ([]*RoadEvent, error)

// QueryRoadsByCondition finds roads by condition status
func (s *SmartContract) QueryRoadsByCondition(
    ctx contractapi.TransactionContextInterface,
    condition string,
) ([]*Road, error)
```

#### Data Model
```go
type Road struct {
    ID          string `json:"id"`
    Name        string `json:"name"`
    Type        string `json:"type"` // NATIONAL_HIGHWAY, STATE_HIGHWAY, etc.
    AuthorityID string `json:"authorityId"`
    Geometry    string `json:"geometry"` // GeoJSON LineString
    Condition   string `json:"condition"` // EXCELLENT, GOOD, FAIR, POOR, CRITICAL
    Length      string `json:"length"`
    CreatedAt   int64  `json:"createdAt"`
    UpdatedAt   int64  `json:"updatedAt"`
}

type RoadEvent struct {
    ID          string `json:"id"`
    RoadID      string `json:"roadId"`
    EventType   string `json:"eventType"` // MAINTENANCE, INSPECTION, COMPLAINT
    Description string `json:"description"`
    Timestamp   int64  `json:"timestamp"`
    ActorID     string `json:"actorId"`
}
```

### Global Routing (`fabric/chaincode/global-routing`)
Provides routing and pathfinding services for complaint assignment and escalation.

#### Key Functions
```go
// CalculateRoute finds optimal path between two points
func (s *SmartContract) CalculateRoute(
    ctx contractapi.TransactionContextInterface,
    startLat string,
    startLng string,
    endLat string,
    endLng string,
) (*Route, error)

// FindNearestAuthority locates closest authority for a location
func (s *SmartContract) FindNearestAuthority(
    ctx contractapi.TransactionContextInterface,
    lat string,
    lng string,
    roadType string,
) (*Authority, error)

// GetEscalationPath determines authority escalation hierarchy
func (s *SmartContract) GetEscalationPath(
    ctx contractapi.TransactionContextInterface,
    authorityId string,
) ([]*Authority, error)
```

#### Data Model
```go
type Route struct {
    ID       string      `json:"id"`
    Distance string      `json:"distance"`
    Duration string      `json:"duration"`
    Points   []RoutePoint `json:"points"`
}

type RoutePoint struct {
    Lat string `json:"lat"`
    Lng string `json:"lng"`
}
```

### Complaint Anchor (`fabric/chaincode/complaint-anchor`)
Go implementation of complaint anchoring (alternative to TypeScript version).

#### Key Functions
```go
// AnchorComplaint stores complaint hash on blockchain
func (s *SmartContract) AnchorComplaint(
    ctx contractapi.TransactionContextInterface,
    complaintId string,
    dataHash string,
    merkleRoot string,
    timestamp string,
) error

// VerifyComplaint validates complaint integrity
func (s *SmartContract) VerifyComplaint(
    ctx contractapi.TransactionContextInterface,
    complaintId string,
    dataHash string,
) (bool, error)
```

## Cross-Chaincode Integration

### Chaincode Invocation
```go
// Example: Complaint chaincode calling Authority Registry
func (s *SmartContract) AssignComplaintToAuthority(
    ctx contractapi.TransactionContextInterface,
    complaintId string,
    lat string,
    lng string,
) error {
    // Call authority-registry chaincode
    response := ctx.GetStub().InvokeChaincode(
        "authority-registry",
        [][]byte{
            []byte("FindNearestAuthority"),
            []byte(lat),
            []byte(lng),
        },
        "roadwatch-india",
    )
    
    if response.Status != 200 {
        return fmt.Errorf("failed to find authority: %s", response.Message)
    }
    
    // Process authority assignment
    // ...
}
```

### Event-Driven Communication
```go
// Emit events for cross-chaincode coordination
func (s *SmartContract) EmitComplaintEvent(
    ctx contractapi.TransactionContextInterface,
    eventType string,
    complaintId string,
    data map[string]interface{},
) error {
    eventPayload, _ := json.Marshal(data)
    return ctx.GetStub().SetEvent(eventType, eventPayload)
}
```

## Deployment Configuration

### Chaincode Packaging
```bash
# Package each chaincode
peer lifecycle chaincode package authority-registry.tar.gz \
    --path ./fabric/chaincode/authority-registry \
    --lang golang \
    --label authority-registry_1.0

peer lifecycle chaincode package budget-registry.tar.gz \
    --path ./fabric/chaincode/budget-registry \
    --lang golang \
    --label budget-registry_1.0

peer lifecycle chaincode package road-registry.tar.gz \
    --path ./fabric/chaincode/road-registry \
    --lang golang \
    --label road-registry_1.0

peer lifecycle chaincode package global-routing.tar.gz \
    --path ./fabric/chaincode/global-routing \
    --lang golang \
    --label global-routing_1.0

peer lifecycle chaincode package complaint-anchor.tar.gz \
    --path ./fabric/chaincode/complaint-anchor \
    --lang golang \
    --label complaint-anchor_0.0.1
```

### Installation and Approval
```bash
# Install on all peers
for chaincode in authority-registry budget-registry road-registry global-routing complaint-anchor; do
    peer lifecycle chaincode install ${chaincode}.tar.gz
    
    # Approve for organization
    peer lifecycle chaincode approveformyorg \
        --channelID roadwatch-india \
        --name ${chaincode} \
        --version 1.0 \
        --package-id ${chaincode}_1.0:$(peer lifecycle chaincode calculatepackageid ${chaincode}.tar.gz) \
        --sequence 1
done
```

### Commit to Channel
```bash
# Commit each chaincode to channel
for chaincode in authority-registry budget-registry road-registry global-routing complaint-anchor; do
    peer lifecycle chaincode commit \
        --channelID roadwatch-india \
        --name ${chaincode} \
        --version 1.0 \
        --sequence 1 \
        --peerAddresses peer0.roadwatch.com:7051 \
        --peerAddresses peer0.authority.com:9051
done
```

## Testing

### Unit Tests
```go
// Example test for Authority Registry
func TestRegisterAuthority(t *testing.T) {
    ctx, stub := setupTest()
    
    err := smartContract.RegisterAuthority(
        ctx,
        "AUTH001",
        "NHAI Delhi",
        "NHAI",
        "Delhi",
        "",
    )
    
    assert.NoError(t, err)
    
    // Verify authority was stored
    authority, err := smartContract.GetAuthority(ctx, "AUTH001")
    assert.NoError(t, err)
    assert.Equal(t, "NHAI Delhi", authority.Name)
}
```

### Integration Tests
```go
// Test cross-chaincode invocation
func TestComplaintAuthorityAssignment(t *testing.T) {
    // Setup multiple chaincodes in test network
    // Test complaint assignment flow
    // Verify authority selection logic
}
```

## Performance Considerations
- Efficient CouchDB indexing for queries
- Batch operations for bulk data updates
- Optimized cross-chaincode calls
- Minimal state reads/writes per transaction
- Proper error handling and rollback

## Security Features
- MSP-based access control per chaincode
- Input validation and sanitization
- Secure cross-chaincode communication
- Audit logging for all operations
- Immutable transaction history

## Monitoring & Maintenance
- Chaincode version management
- Performance metrics collection
- Error rate monitoring
- State database optimization
- Regular backup procedures