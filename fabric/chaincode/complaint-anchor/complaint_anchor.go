package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	peer "github.com/hyperledger/fabric-protos-go/peer"
)

const (
	KeyPrefixAnchor     = "ANCHOR"
	KeyPrefixEscalation = "ESCALATION"
	KeyPrefixResolution = "RESOLUTION"

	// Validation
	MerkleRootLength = 64
	MaxBatchSize     = 100
	MaxTier          = 5
	MaxDaysOpen      = 3650 // 10 years max
	MaxNotesLength   = 500
)

var (
	merkleRootRegex = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// ComplaintAnchorContract immutably anchors complaint batches, escalation notifications, and resolutions.
type ComplaintAnchorContract struct {
	contractapi.Contract
}

// Init is a no-op shim entrypoint.
func (c *ComplaintAnchorContract) Init(stub shim.ChaincodeStubInterface) peer.Response {
	return peer.Response{Status: 200}
}

// Invoke is a no-op shim entrypoint.
func (c *ComplaintAnchorContract) Invoke(stub shim.ChaincodeStubInterface) peer.Response {
	return peer.Response{Status: 200}
}

// MerkleAnchor immutably stores the Merkle root for a complaint batch.
type MerkleAnchor struct {
	AnchorID    string `json:"anchorId"`
	MerkleRoot  string `json:"merkleRoot"`
	BatchSize   int    `json:"batchSize"`
	RegionCode  string `json:"regionCode"`
	SubmittedBy string `json:"submittedBy"`
	TxID        string `json:"txId"`
	Timestamp   int64  `json:"timestamp"`
}

// EscalationAnchor immutably records an escalation notification.
type EscalationAnchor struct {
	AnchorID        string `json:"anchorId"`
	ComplaintID     string `json:"complaintId"`
	FromAuthorityID string `json:"fromAuthorityId"`
	ToAuthorityID   string `json:"toAuthorityId"`
	Tier            int    `json:"tier"`
	DaysOpen        int    `json:"daysOpen"`
	TxID            string `json:"txId"`
	AnchoredBy      string `json:"anchoredBy"`
	Timestamp       int64  `json:"timestamp"`
}

// ResolutionAnchor immutably records a resolution proof.
type ResolutionAnchor struct {
	AnchorID      string `json:"anchorId"`
	ComplaintID   string `json:"complaintId"`
	ResolvedBy    string `json:"resolvedBy"`
	ResolvedByMSP string `json:"resolvedByMSP"`
	RepairCID     string `json:"repairCID"`
	CaptureHash   string `json:"captureHash"`
	TxID          string `json:"txId"`
	Timestamp     int64  `json:"timestamp"`
}

// AnchorPage is a paginated response for Merkle anchors.
type AnchorPage struct {
	Anchors  []*MerkleAnchor `json:"anchors"`
	Bookmark string          `json:"bookmark"`
	Count    int             `json:"count"`
}

// SubmitMerkleRoot immutably anchors a complaint batch Merkle root.
// Access: RoadWatchMSP or NHAIMSP.
func (c *ComplaintAnchorContract) SubmitMerkleRoot(
	ctx contractapi.TransactionContextInterface,
	merkleRoot string,
	regionCode string,
	batchSize int,
) error {
	mspID, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return fmt.Errorf("SubmitMerkleRoot: failed to get MSP ID: %w", err)
	}
	if mspID != "NHAIMSP" && mspID != "RoadWatchMSP" {
		return fmt.Errorf("SubmitMerkleRoot: unauthorized MSP: %s", mspID)
	}

	if err := validateNotEmpty("merkleRoot", merkleRoot); err != nil {
		return fmt.Errorf("SubmitMerkleRoot: %w", err)
	}
	if len(merkleRoot) != MerkleRootLength {
		return fmt.Errorf("SubmitMerkleRoot: invalid merkleRoot: must be %d chars, got %d", MerkleRootLength, len(merkleRoot))
	}
	if !merkleRootRegex.MatchString(merkleRoot) {
		return fmt.Errorf("SubmitMerkleRoot: invalid merkleRoot: must be lowercase hex length %d", MerkleRootLength)
	}

	if err := validateNotEmpty("regionCode", regionCode); err != nil {
		return fmt.Errorf("SubmitMerkleRoot: %w", err)
	}
	if err := validateStringLength("regionCode", regionCode, 10); err != nil {
		return fmt.Errorf("SubmitMerkleRoot: %w", err)
	}

	if batchSize < 1 || batchSize > MaxBatchSize {
		return fmt.Errorf("SubmitMerkleRoot: invalid batchSize: must be between 1 and %d, got %d", MaxBatchSize, batchSize)
	}

	key, err := ctx.GetStub().CreateCompositeKey(KeyPrefixAnchor, []string{merkleRoot})
	if err != nil {
		return fmt.Errorf("SubmitMerkleRoot: failed to create key: %w", err)
	}

	var existing MerkleAnchor
	exists, err := c.getState(ctx, key, &existing)
	if err != nil {
		return fmt.Errorf("SubmitMerkleRoot: %w", err)
	}
	if exists {
		return nil
	}

	txTimestamp, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return fmt.Errorf("SubmitMerkleRoot: failed to get tx timestamp: %w", err)
	}
	timestamp := txTimestamp.Seconds

	record := MerkleAnchor{
		AnchorID:    "ANCHOR_" + merkleRoot[:16],
		MerkleRoot:  merkleRoot,
		BatchSize:   batchSize,
		RegionCode:  regionCode,
		SubmittedBy: mspID,
		TxID:        ctx.GetStub().GetTxID(),
		Timestamp:   timestamp,
	}

	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("SubmitMerkleRoot: failed to marshal record: %w", err)
	}
	if err := ctx.GetStub().PutState(key, data); err != nil {
		return fmt.Errorf("SubmitMerkleRoot: failed to put state: %w", err)
	}
	if err := ctx.GetStub().SetEvent("MerkleRootAnchored", data); err != nil {
		return fmt.Errorf("SubmitMerkleRoot: failed to emit event: %w", err)
	}
	return nil
}

// VerifyMerkleRoot verifies whether a Merkle root has been anchored.
// Access: any consortium member.
func (c *ComplaintAnchorContract) VerifyMerkleRoot(
	ctx contractapi.TransactionContextInterface,
	merkleRoot string,
) (*MerkleAnchor, error) {
	if err := validateNotEmpty("merkleRoot", merkleRoot); err != nil {
		return nil, fmt.Errorf("VerifyMerkleRoot: %w", err)
	}
	if len(merkleRoot) != MerkleRootLength {
		return nil, fmt.Errorf("VerifyMerkleRoot: invalid merkleRoot: must be %d chars, got %d", MerkleRootLength, len(merkleRoot))
	}
	if !merkleRootRegex.MatchString(merkleRoot) {
		return nil, fmt.Errorf("VerifyMerkleRoot: invalid merkleRoot: must be lowercase hex length %d", MerkleRootLength)
	}

	key, err := ctx.GetStub().CreateCompositeKey(KeyPrefixAnchor, []string{merkleRoot})
	if err != nil {
		return nil, fmt.Errorf("VerifyMerkleRoot: failed to create key: %w", err)
	}

	var record MerkleAnchor
	exists, err := c.getState(ctx, key, &record)
	if err != nil {
		return nil, fmt.Errorf("VerifyMerkleRoot: %w", err)
	}
	if !exists {
		return nil, fmt.Errorf("VerifyMerkleRoot: anchor not found: %s", merkleRoot)
	}
	return &record, nil
}

// AnchorEscalation immutably anchors an escalation notification.
// Access: RoadWatchMSP only.
func (c *ComplaintAnchorContract) AnchorEscalation(
	ctx contractapi.TransactionContextInterface,
	complaintID string,
	fromAuthorityID string,
	toAuthorityID string,
	tier int,
	daysOpen int,
) error {
	mspID, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return fmt.Errorf("AnchorEscalation: failed to get MSP ID: %w", err)
	}
	if mspID != "RoadWatchMSP" {
		return fmt.Errorf("AnchorEscalation: only RoadWatchMSP can perform this action, got: %s", mspID)
	}

	if err := validateNotEmpty("complaintID", complaintID); err != nil {
		return fmt.Errorf("AnchorEscalation: %w", err)
	}
	if err := validateStringLength("complaintID", complaintID, 100); err != nil {
		return fmt.Errorf("AnchorEscalation: %w", err)
	}
	if err := validateNotEmpty("fromAuthorityID", fromAuthorityID); err != nil {
		return fmt.Errorf("AnchorEscalation: %w", err)
	}
	if err := validateNotEmpty("toAuthorityID", toAuthorityID); err != nil {
		return fmt.Errorf("AnchorEscalation: %w", err)
	}
	if fromAuthorityID == toAuthorityID {
		return fmt.Errorf("AnchorEscalation: invalid authority routing: fromAuthorityID must differ from toAuthorityID")
	}
	if tier < 1 || tier > MaxTier {
		return fmt.Errorf("AnchorEscalation: invalid tier: must be between 1 and %d, got %d", MaxTier, tier)
	}
	if daysOpen < 0 || daysOpen > MaxDaysOpen {
		return fmt.Errorf("AnchorEscalation: invalid daysOpen: must be between 0 and %d, got %d", MaxDaysOpen, daysOpen)
	}

	txTimestamp, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return fmt.Errorf("AnchorEscalation: failed to get tx timestamp: %w", err)
	}
	timestamp := txTimestamp.Seconds
	stampStr := strconv.FormatInt(timestamp, 10)

	key, err := ctx.GetStub().CreateCompositeKey(KeyPrefixEscalation, []string{complaintID, stampStr})
	if err != nil {
		return fmt.Errorf("AnchorEscalation: failed to create key: %w", err)
	}

	var existing EscalationAnchor
	exists, err := c.getState(ctx, key, &existing)
	if err != nil {
		return fmt.Errorf("AnchorEscalation: %w", err)
	}
	if exists {
		return fmt.Errorf("AnchorEscalation: escalation already exists: %s", complaintID)
	}

	record := EscalationAnchor{
		AnchorID:        "ESC_" + complaintID + "_" + strconv.Itoa(tier),
		ComplaintID:     complaintID,
		FromAuthorityID: fromAuthorityID,
		ToAuthorityID:   toAuthorityID,
		Tier:            tier,
		DaysOpen:        daysOpen,
		TxID:            ctx.GetStub().GetTxID(),
		AnchoredBy:      mspID,
		Timestamp:       timestamp,
	}

	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("AnchorEscalation: failed to marshal record: %w", err)
	}
	if err := ctx.GetStub().PutState(key, data); err != nil {
		return fmt.Errorf("AnchorEscalation: failed to put state: %w", err)
	}
	if err := ctx.GetStub().SetEvent("EscalationAnchored", data); err != nil {
		return fmt.Errorf("AnchorEscalation: failed to emit event: %w", err)
	}
	return nil
}

// AnchorResolution immutably anchors a complaint resolution proof.
// Access: NHAIMSP or RoadWatchMSP.
func (c *ComplaintAnchorContract) AnchorResolution(
	ctx contractapi.TransactionContextInterface,
	complaintID string,
	resolvedBy string,
	repairCID string,
	captureHash string,
) error {
	mspID, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return fmt.Errorf("AnchorResolution: failed to get MSP ID: %w", err)
	}
	if mspID != "NHAIMSP" && mspID != "RoadWatchMSP" {
		return fmt.Errorf("AnchorResolution: unauthorized MSP: %s", mspID)
	}

	if err := validateNotEmpty("complaintID", complaintID); err != nil {
		return fmt.Errorf("AnchorResolution: %w", err)
	}
	if err := validateNotEmpty("resolvedBy", resolvedBy); err != nil {
		return fmt.Errorf("AnchorResolution: %w", err)
	}
	if err := validateNotEmpty("repairCID", repairCID); err != nil {
		return fmt.Errorf("AnchorResolution: %w", err)
	}
	if !strings.HasPrefix(repairCID, "Qm") && !strings.HasPrefix(repairCID, "bafy") {
		return fmt.Errorf("AnchorResolution: invalid repairCID: must start with Qm or bafy")
	}
	if err := validateNotEmpty("captureHash", captureHash); err != nil {
		return fmt.Errorf("AnchorResolution: %w", err)
	}
	if len(captureHash) != MerkleRootLength {
		return fmt.Errorf("AnchorResolution: invalid captureHash: must be %d chars, got %d", MerkleRootLength, len(captureHash))
	}
	if !merkleRootRegex.MatchString(captureHash) {
		return fmt.Errorf("AnchorResolution: invalid captureHash: must be lowercase hex length %d", MerkleRootLength)
	}

	key, err := ctx.GetStub().CreateCompositeKey(KeyPrefixResolution, []string{complaintID})
	if err != nil {
		return fmt.Errorf("AnchorResolution: failed to create key: %w", err)
	}

	var existing ResolutionAnchor
	exists, err := c.getState(ctx, key, &existing)
	if err != nil {
		return fmt.Errorf("AnchorResolution: %w", err)
	}
	if exists {
		return fmt.Errorf("AnchorResolution: complaint already resolved: %s", complaintID)
	}

	txTimestamp, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return fmt.Errorf("AnchorResolution: failed to get tx timestamp: %w", err)
	}
	timestamp := txTimestamp.Seconds

	record := ResolutionAnchor{
		AnchorID:      "RES_" + complaintID,
		ComplaintID:   complaintID,
		ResolvedBy:    resolvedBy,
		ResolvedByMSP: mspID,
		RepairCID:     repairCID,
		CaptureHash:   captureHash,
		TxID:          ctx.GetStub().GetTxID(),
		Timestamp:     timestamp,
	}

	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("AnchorResolution: failed to marshal record: %w", err)
	}
	if err := ctx.GetStub().PutState(key, data); err != nil {
		return fmt.Errorf("AnchorResolution: failed to put state: %w", err)
	}
	if err := ctx.GetStub().SetEvent("ComplaintResolved", data); err != nil {
		return fmt.Errorf("AnchorResolution: failed to emit event: %w", err)
	}
	return nil
}

// GetEscalationHistory returns the escalation anchors for a complaint.
// Access: any consortium member.
func (c *ComplaintAnchorContract) GetEscalationHistory(
	ctx contractapi.TransactionContextInterface,
	complaintID string,
) ([]*EscalationAnchor, error) {
	if err := validateNotEmpty("complaintID", complaintID); err != nil {
		return nil, fmt.Errorf("GetEscalationHistory: %w", err)
	}

	query := map[string]any{
		"selector": map[string]any{
			"complaintId": complaintID,
		},
		"sort": []map[string]string{{"timestamp": "asc"}},
	}
	queryBytes, err := json.Marshal(query)
	if err != nil {
		return nil, fmt.Errorf("GetEscalationHistory: failed to marshal query: %w", err)
	}

	iterator, err := ctx.GetStub().GetQueryResult(string(queryBytes))
	if err != nil {
		return nil, fmt.Errorf("GetEscalationHistory: failed to query: %w", err)
	}
	defer iterator.Close()

	results := make([]*EscalationAnchor, 0)
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, fmt.Errorf("GetEscalationHistory: failed to iterate: %w", err)
		}
		var record EscalationAnchor
		if err := json.Unmarshal(item.Value, &record); err != nil {
			return nil, fmt.Errorf("GetEscalationHistory: failed to unmarshal: %w", err)
		}
		r := record
		results = append(results, &r)
	}
	return results, nil
}

// GetAnchorsByRegion returns Merkle anchors by region within a time window.
// Access: any consortium member.
func (c *ComplaintAnchorContract) GetAnchorsByRegion(
	ctx contractapi.TransactionContextInterface,
	regionCode string,
	fromTimestamp int64,
	toTimestamp int64,
	pageSize int32,
	bookmark string,
) (*AnchorPage, error) {
	if err := validateNotEmpty("regionCode", regionCode); err != nil {
		return nil, fmt.Errorf("GetAnchorsByRegion: %w", err)
	}
	if fromTimestamp >= toTimestamp {
		return nil, fmt.Errorf("GetAnchorsByRegion: invalid time range: fromTimestamp must be < toTimestamp")
	}
	pageSize = normalizePageSize(pageSize)

	query := map[string]any{
		"selector": map[string]any{
			"regionCode": regionCode,
			"timestamp": map[string]any{"$gte": fromTimestamp, "$lte": toTimestamp},
		},
		"sort": []map[string]string{{"timestamp": "asc"}},
	}
	queryBytes, err := json.Marshal(query)
	if err != nil {
		return nil, fmt.Errorf("GetAnchorsByRegion: failed to marshal query: %w", err)
	}

	iterator, metadata, err := ctx.GetStub().GetQueryResultWithPagination(string(queryBytes), pageSize, bookmark)
	if err != nil {
		return nil, fmt.Errorf("GetAnchorsByRegion: failed to query: %w", err)
	}
	defer iterator.Close()

	anchors := make([]*MerkleAnchor, 0)
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, fmt.Errorf("GetAnchorsByRegion: failed to iterate: %w", err)
		}
		var record MerkleAnchor
		if err := json.Unmarshal(item.Value, &record); err != nil {
			return nil, fmt.Errorf("GetAnchorsByRegion: failed to unmarshal: %w", err)
		}
		r := record
		anchors = append(anchors, &r)
	}

	nextBookmark := ""
	if metadata != nil {
		nextBookmark = metadata.Bookmark
	}

	return &AnchorPage{Anchors: anchors, Bookmark: nextBookmark, Count: len(anchors)}, nil
}

// GetResolutionProof returns the on-chain resolution proof for a complaint.
// Access: any consortium member.
func (c *ComplaintAnchorContract) GetResolutionProof(
	ctx contractapi.TransactionContextInterface,
	complaintID string,
) (*ResolutionAnchor, error) {
	if err := validateNotEmpty("complaintID", complaintID); err != nil {
		return nil, fmt.Errorf("GetResolutionProof: %w", err)
	}

	key, err := ctx.GetStub().CreateCompositeKey(KeyPrefixResolution, []string{complaintID})
	if err != nil {
		return nil, fmt.Errorf("GetResolutionProof: failed to create key: %w", err)
	}

	var record ResolutionAnchor
	exists, err := c.getState(ctx, key, &record)
	if err != nil {
		return nil, fmt.Errorf("GetResolutionProof: %w", err)
	}
	if !exists {
		return nil, fmt.Errorf("GetResolutionProof: resolution not found: %s", complaintID)
	}
	return &record, nil
}

// InitLedger seeds minimal data for testing.
func (c *ComplaintAnchorContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	mspID, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return fmt.Errorf("InitLedger: failed to get MSP ID: %w", err)
	}
	if mspID != "NHAIMSP" && mspID != "RoadWatchMSP" {
		return fmt.Errorf("InitLedger: unauthorized MSP: %s", mspID)
	}

	cert, err := ctx.GetClientIdentity().GetX509Certificate()
	if err != nil {
		return fmt.Errorf("InitLedger: failed to get x509 certificate: %w", err)
	}
	if cert == nil || !strings.Contains(cert.Subject.CommonName, "Admin") {
		return fmt.Errorf("InitLedger: unauthorized: Admin identity required")
	}

	txTimestamp, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return fmt.Errorf("InitLedger: failed to get tx timestamp: %w", err)
	}
	timestamp := txTimestamp.Seconds

	seedMerkleRoot := strings.Repeat("a", 64)
	anchorKey, err := ctx.GetStub().CreateCompositeKey(KeyPrefixAnchor, []string{seedMerkleRoot})
	if err != nil {
		return fmt.Errorf("InitLedger: failed to create key: %w", err)
	}
	var existingAnchor MerkleAnchor
	anchorExists, err := c.getState(ctx, anchorKey, &existingAnchor)
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}
	if !anchorExists {
		rec := MerkleAnchor{
			AnchorID:    "ANCHOR_" + seedMerkleRoot[:16],
			MerkleRoot:  seedMerkleRoot,
			BatchSize:   3,
			RegionCode:  "IN-DL",
			SubmittedBy: mspID,
			TxID:        ctx.GetStub().GetTxID(),
			Timestamp:   timestamp,
		}
		b, err := json.Marshal(rec)
		if err != nil {
			return fmt.Errorf("InitLedger: failed to marshal MerkleAnchor: %w", err)
		}
		if err := ctx.GetStub().PutState(anchorKey, b); err != nil {
			return fmt.Errorf("InitLedger: failed to put MerkleAnchor: %w", err)
		}
	}

	seedComplaintID := "COMPLAINT_SEED_1"
	escIter, err := ctx.GetStub().GetStateByPartialCompositeKey(KeyPrefixEscalation, []string{seedComplaintID})
	if err != nil {
		return fmt.Errorf("InitLedger: failed to query existing escalations: %w", err)
	}
	defer escIter.Close()

	escExists := escIter.HasNext()
	if !escExists {
		escKey, err := ctx.GetStub().CreateCompositeKey(KeyPrefixEscalation, []string{seedComplaintID, strconv.FormatInt(timestamp, 10)})
		if err != nil {
			return fmt.Errorf("InitLedger: failed to create key: %w", err)
		}

		rec := EscalationAnchor{
			AnchorID:        "ESC_" + seedComplaintID + "_" + strconv.Itoa(1),
			ComplaintID:     seedComplaintID,
			FromAuthorityID: "AUTH_FROM_1",
			ToAuthorityID:   "AUTH_TO_1",
			Tier:            1,
			DaysOpen:        8,
			TxID:            ctx.GetStub().GetTxID(),
			AnchoredBy:      mspID,
			Timestamp:       timestamp,
		}
		b, err := json.Marshal(rec)
		if err != nil {
			return fmt.Errorf("InitLedger: failed to marshal EscalationAnchor: %w", err)
		}
		if err := ctx.GetStub().PutState(escKey, b); err != nil {
			return fmt.Errorf("InitLedger: failed to put EscalationAnchor: %w", err)
		}
	}

	resKey, err := ctx.GetStub().CreateCompositeKey(KeyPrefixResolution, []string{seedComplaintID})
	if err != nil {
		return fmt.Errorf("InitLedger: failed to create key: %w", err)
	}
	var existingRes ResolutionAnchor
	resExists, err := c.getState(ctx, resKey, &existingRes)
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}
	if !resExists {
		rec := ResolutionAnchor{
			AnchorID:      "RES_" + seedComplaintID,
			ComplaintID:   seedComplaintID,
			ResolvedBy:    "AUTH_PERSON_1",
			ResolvedByMSP: mspID,
			RepairCID:     "QmTestCID123...",
			CaptureHash:   strings.Repeat("b", 64),
			TxID:          ctx.GetStub().GetTxID(),
			Timestamp:     timestamp,
		}
		b, err := json.Marshal(rec)
		if err != nil {
			return fmt.Errorf("InitLedger: failed to marshal ResolutionAnchor: %w", err)
		}
		if err := ctx.GetStub().PutState(resKey, b); err != nil {
			return fmt.Errorf("InitLedger: failed to put ResolutionAnchor: %w", err)
		}
	}

	initEvent := struct {
		Timestamp int64 `json:"timestamp"`
	}{Timestamp: timestamp}
	ev, err := json.Marshal(initEvent)
	if err != nil {
		return fmt.Errorf("InitLedger: failed to marshal event: %w", err)
	}
	if err := ctx.GetStub().SetEvent("LedgerInitialized", ev); err != nil {
		return fmt.Errorf("InitLedger: failed to emit event: %w", err)
	}

	return nil
}

func (c *ComplaintAnchorContract) getState(
	ctx contractapi.TransactionContextInterface,
	key string,
	target interface{},
) (bool, error) {
	data, err := ctx.GetStub().GetState(key)
	if err != nil {
		return false, fmt.Errorf("getState: failed to read: %w", err)
	}
	if data == nil {
		return false, nil
	}
	if err := json.Unmarshal(data, target); err != nil {
		return false, fmt.Errorf("getState: failed to unmarshal: %w", err)
	}
	return true, nil
}

func normalizePageSize(pageSize int32) int32 {
	if pageSize <= 0 {
		return 25
	}
	if pageSize > 100 {
		return 100
	}
	return pageSize
}

func validateNotEmpty(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("invalid %s: must not be empty", field)
	}
	return nil
}

func validatePositiveInt64(field string, value int64) error {
	if value <= 0 {
		return fmt.Errorf("invalid %s: must be positive, got %d", field, value)
	}
	return nil
}

func validateNonNegativeInt64(field string, value int64) error {
	if value < 0 {
		return fmt.Errorf("invalid %s: must be non-negative, got %d", field, value)
	}
	return nil
}

func validateEnum(field, value string, allowed []string) error {
	for _, a := range allowed {
		if value == a {
			return nil
		}
	}
	return fmt.Errorf("invalid %s: %q not in allowed values %v", field, value, allowed)
}

func validateStringLength(field, value string, maxLen int) error {
	if len(value) > maxLen {
		return fmt.Errorf("invalid %s: exceeds max length %d", field, maxLen)
	}
	return nil
}

func main() {
	chaincode, err := contractapi.NewChaincode(&ComplaintAnchorContract{})
	if err != nil {
		panic(err)
	}
	if err := chaincode.Start(); err != nil {
		panic(err)
	}
}
