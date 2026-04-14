package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/hyperledger/fabric-chaincode-go/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/hyperledger/fabric-protos-go/peer"
)

type AuthorityRecord struct {
	AuthorityID    string   `json:"authorityId"`
	Name           string   `json:"name"`
	Role           string   `json:"role"`
	Department     string   `json:"department"`
	RegionCodes    []string `json:"regionCodes"`
	RoadTypes      []string `json:"roadTypes"`
	ContactHash    string   `json:"contactHash"`
	IsActive       bool     `json:"isActive"`
	RegisteredBy   string   `json:"registeredBy"`
	ChainCreatedAt int64    `json:"chainCreatedAt"`
	ChainUpdatedAt int64    `json:"chainUpdatedAt"`
	Version        int      `json:"version"`
}

type ActionLog struct {
	LogID          string `json:"logId"`
	AuthorityID    string `json:"authorityId"`
	ComplaintID    string `json:"complaintId"`
	ActionType     string `json:"actionType"`
	Notes          string `json:"notes"`
	TxID           string `json:"txId"`
	Timestamp      int64  `json:"timestamp"`
	PerformedByMSP string `json:"performedByMsp"`
}

type PerformanceScore struct {
	AuthorityID    string  `json:"authorityId"`
	FromEpoch      int64   `json:"fromEpoch"`
	ToEpoch        int64   `json:"toEpoch"`
	TotalAssigned  int     `json:"totalAssigned"`
	TotalResolved  int     `json:"totalResolved"`
	Score          float64 `json:"score"`
	ComputedAt     int64   `json:"computedAt"`
}

type AuthorityPage struct {
	Authorities []*AuthorityRecord `json:"authorities"`
	Bookmark    string             `json:"bookmark"`
	Count       int                `json:"count"`
}

type ActionPage struct {
	Actions  []*ActionLog `json:"actions"`
	Bookmark string       `json:"bookmark"`
	Count    int          `json:"count"`
}

const (
	KeyPrefixAuthority = "AUTHORITY"
	KeyPrefixAction    = "ACTION"

	MaxNameLength     = 200
	MaxNotesLength    = 500
	MaxRegionCodes    = 20
	MaxContactHashLen = 64
)

var (
	AllowedRoles = []string{
		"EE",
		"SE",
		"CE",
		"MinistryOfficer",
		"Inspector",
		"FieldEngineer",
	}

	AllowedDepartments = []string{
		"NHAI", "PWD", "Municipal", "RES", "Ministry",
	}

	AllowedRoadTypes = []string{
		"NH", "SH", "MDR", "ODR", "VR", "Urban",
	}

	AllowedActionTypes = []string{
		"ACKNOWLEDGED",
		"ASSIGNED",
		"INSPECTION_STARTED",
		"INSPECTION_COMPLETED",
		"REPAIR_SCHEDULED",
		"REPAIR_STARTED",
		"REPAIR_COMPLETED",
		"RESOLVED",
		"REJECTED",
		"ESCALATED",
		"NOTE_ADDED",
	}
)

const (
	defaultPageSize = int32(25)
	maxPageSize     = int32(100)
)

var contactHashRe = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

type AuthorityRegistryContract struct {
	contractapi.Contract
}

func (c *AuthorityRegistryContract) Init(stub shim.ChaincodeStubInterface) peer.Response {
	return peer.Response{Status: 200}
}

func (c *AuthorityRegistryContract) Invoke(stub shim.ChaincodeStubInterface) peer.Response {
	return peer.Response{Status: 500, Message: "Invoke not supported; call contract methods directly"}
}

func (c *AuthorityRegistryContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	mspID, err := requireMSP(ctx, []string{"NHAIMSP"})
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}
	if err := requireAdminCN(ctx); err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}

	seedID := "EE-NHAI-ZONE3-001"
	k, err := authorityKey(ctx, seedID)
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}
	existing, err := ctx.GetStub().GetState(k)
	if err != nil {
		return fmt.Errorf("InitLedger: get state: %w", err)
	}
	if existing != nil {
		return nil
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}

	seeds := []*AuthorityRecord{
		{
			AuthorityID: seedID,
			Name:        "Er. Ramesh Kumar",
			Role:        "EE",
			Department:  "NHAI",
			RegionCodes: []string{"IN-DL", "IN-HR"},
			RoadTypes:   []string{"NH", "SH"},
			IsActive:    true,
		},
		{
			AuthorityID: "SE-NHAI-NORTH-001",
			Name:        "Er. Priya Sharma",
			Role:        "SE",
			Department:  "NHAI",
			RegionCodes: []string{"IN-DL", "IN-HR", "IN-UP", "IN-PB"},
			RoadTypes:   []string{"NH", "SH"},
			IsActive:    true,
		},
		{
			AuthorityID: "INS-PWD-DL-001",
			Name:        "Er. Amit Singh",
			Role:        "Inspector",
			Department:  "PWD",
			RegionCodes: []string{"IN-DL"},
			RoadTypes:   []string{"SH", "MDR", "Urban"},
			IsActive:    true,
		},
	}

	for _, a := range seeds {
		if err := validateAuthorityRecord(a); err != nil {
			return fmt.Errorf("InitLedger: seed validation: %w", err)
		}
		a.RegisteredBy = mspID
		a.ChainCreatedAt = ts
		a.ChainUpdatedAt = ts
		a.Version = 1

		ak, err := authorityKey(ctx, a.AuthorityID)
		if err != nil {
			return fmt.Errorf("InitLedger: %w", err)
		}
		if err := putJSON(ctx, ak, a); err != nil {
			return fmt.Errorf("InitLedger: put authority: %w", err)
		}
	}

	return nil
}

func (c *AuthorityRegistryContract) RegisterAuthority(ctx contractapi.TransactionContextInterface, authorityJSON string) error {
	mspID, err := requireMSP(ctx, []string{"NHAIMSP"})
	if err != nil {
		return fmt.Errorf("RegisterAuthority: %w", err)
	}

	var a AuthorityRecord
	if err := json.Unmarshal([]byte(authorityJSON), &a); err != nil {
		return fmt.Errorf("RegisterAuthority: invalid json: %w", err)
	}

	// Default active to true (JSON omission results in false; spec defaults to true).
	if !a.IsActive {
		a.IsActive = true
	}

	if err := validateAuthorityRecord(&a); err != nil {
		return fmt.Errorf("RegisterAuthority: %w", err)
	}

	k, err := authorityKey(ctx, a.AuthorityID)
	if err != nil {
		return fmt.Errorf("RegisterAuthority: %w", err)
	}
	if exists, err := stateExists(ctx, k); err != nil {
		return fmt.Errorf("RegisterAuthority: %w", err)
	} else if exists {
		return fmt.Errorf("RegisterAuthority: authority already exists")
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("RegisterAuthority: %w", err)
	}
		
	a.RegisteredBy = mspID
	a.ChainCreatedAt = ts
	a.ChainUpdatedAt = ts
	a.Version = 1

	if err := putJSON(ctx, k, &a); err != nil {
		return fmt.Errorf("RegisterAuthority: put authority: %w", err)
	}

	if err := emitEvent(ctx, "AuthorityRegistered", &a); err != nil {
		return fmt.Errorf("RegisterAuthority: %w", err)
	}
	return nil
}

func (c *AuthorityRegistryContract) UpdateAuthority(ctx contractapi.TransactionContextInterface, authorityID string, updateJSON string) error {
	if _, err := requireMSP(ctx, []string{"NHAIMSP"}); err != nil {
		return fmt.Errorf("UpdateAuthority: %w", err)
	}
	if strings.TrimSpace(authorityID) == "" {
		return fmt.Errorf("UpdateAuthority: authorityID must not be empty")
	}

	existing, err := c.GetAuthority(ctx, authorityID)
	if err != nil {
		return fmt.Errorf("UpdateAuthority: %w", err)
	}

	var upd AuthorityRecord
	if err := json.Unmarshal([]byte(updateJSON), &upd); err != nil {
		return fmt.Errorf("UpdateAuthority: invalid json: %w", err)
	}
	if upd.AuthorityID != "" && upd.AuthorityID != authorityID {
		return fmt.Errorf("UpdateAuthority: cannot change authorityId")
	}
	if upd.Version != existing.Version {
		return fmt.Errorf("UpdateAuthority: version conflict")
	}

	next := &AuthorityRecord{
		AuthorityID:    existing.AuthorityID,
		RegisteredBy:   existing.RegisteredBy,
		ChainCreatedAt: existing.ChainCreatedAt,

		Name:        upd.Name,
		Role:        upd.Role,
		Department:  upd.Department,
		RegionCodes: upd.RegionCodes,
		RoadTypes:   upd.RoadTypes,
		ContactHash: upd.ContactHash,
		IsActive:    upd.IsActive,
	}

	if err := validateAuthorityRecord(next); err != nil {
		return fmt.Errorf("UpdateAuthority: %w", err)
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("UpdateAuthority: %w", err)
	}
	next.ChainUpdatedAt = ts
	next.Version = existing.Version + 1

	k, err := authorityKey(ctx, authorityID)
	if err != nil {
		return fmt.Errorf("UpdateAuthority: %w", err)
	}
	if err := putJSON(ctx, k, next); err != nil {
		return fmt.Errorf("UpdateAuthority: put authority: %w", err)
	}

	if err := emitEvent(ctx, "AuthorityUpdated", next); err != nil {
		return fmt.Errorf("UpdateAuthority: %w", err)
	}
	return nil
}

func (c *AuthorityRegistryContract) DeactivateAuthority(ctx contractapi.TransactionContextInterface, authorityID string) error {
	if _, err := requireMSP(ctx, []string{"NHAIMSP"}); err != nil {
		return fmt.Errorf("DeactivateAuthority: %w", err)
	}
	if strings.TrimSpace(authorityID) == "" {
		return fmt.Errorf("DeactivateAuthority: authorityID must not be empty")
	}

	a, err := c.GetAuthority(ctx, authorityID)
	if err != nil {
		return fmt.Errorf("DeactivateAuthority: %w", err)
	}
	if !a.IsActive {
		return fmt.Errorf("DeactivateAuthority: already inactive: %s", authorityID)
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("DeactivateAuthority: %w", err)
	}

	a.IsActive = false
	a.Version++
	a.ChainUpdatedAt = ts

	k, err := authorityKey(ctx, authorityID)
	if err != nil {
		return fmt.Errorf("DeactivateAuthority: %w", err)
	}
	if err := putJSON(ctx, k, a); err != nil {
		return fmt.Errorf("DeactivateAuthority: put authority: %w", err)
	}

	payload := map[string]any{"authorityId": authorityID, "timestamp": ts}
	if err := emitEvent(ctx, "AuthorityDeactivated", payload); err != nil {
		return fmt.Errorf("DeactivateAuthority: %w", err)
	}
	return nil
}

func (c *AuthorityRegistryContract) LogAction(ctx contractapi.TransactionContextInterface, complaintID string, authorityID string, actionType string, notes string) error {
	mspID, err := requireMSP(ctx, []string{"RoadWatchMSP", "NHAIMSP"})
	if err != nil {
		return fmt.Errorf("LogAction: %w", err)
	}

	complaintID = strings.TrimSpace(complaintID)
	authorityID = strings.TrimSpace(authorityID)
	actionType = strings.TrimSpace(actionType)

	if complaintID == "" {
		return fmt.Errorf("LogAction: complaintID must not be empty")
	}
	if len(complaintID) > 100 {
		return fmt.Errorf("LogAction: complaintID too long")
	}
	if authorityID == "" {
		return fmt.Errorf("LogAction: authorityID must not be empty")
	}
	if !contains(AllowedActionTypes, actionType) {
		return fmt.Errorf("LogAction: invalid actionType")
	}

	if len(notes) > MaxNotesLength {
		notes = notes[:MaxNotesLength]
	}

	a, err := c.GetAuthority(ctx, authorityID)
	if err != nil {
		if errors.Is(err, errNotFound) {
			return fmt.Errorf("LogAction: authority not found: %s", authorityID)
		}
		return fmt.Errorf("LogAction: %w", err)
	}
	if !a.IsActive {
		return fmt.Errorf("LogAction: authority is not active: %s", authorityID)
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("LogAction: %w", err)
	}
	logID := fmt.Sprintf("%s_%s_%s_%d", authorityID, complaintID, actionType, ts)

	k, err := actionKey(ctx, authorityID, ts, complaintID)
	if err != nil {
		return fmt.Errorf("LogAction: %w", err)
	}

	log := &ActionLog{
		LogID:          logID,
		AuthorityID:    authorityID,
		ComplaintID:    complaintID,
		ActionType:     actionType,
		Notes:          notes,
		TxID:           ctx.GetStub().GetTxID(),
		Timestamp:      ts,
		PerformedByMSP: mspID,
	}

	if err := putJSON(ctx, k, log); err != nil {
		return fmt.Errorf("LogAction: put action: %w", err)
	}

	if err := emitEvent(ctx, "AuthorityActionLogged", log); err != nil {
		return fmt.Errorf("LogAction: %w", err)
	}
	return nil
}

func (c *AuthorityRegistryContract) GetAuthority(ctx contractapi.TransactionContextInterface, authorityID string) (*AuthorityRecord, error) {
	authorityID = strings.TrimSpace(authorityID)
	if authorityID == "" {
		return nil, fmt.Errorf("GetAuthority: authorityID must not be empty")
	}
	k, err := authorityKey(ctx, authorityID)
	if err != nil {
		return nil, fmt.Errorf("GetAuthority: %w", err)
	}
	b, err := ctx.GetStub().GetState(k)
	if err != nil {
		return nil, fmt.Errorf("GetAuthority: %w", err)
	}
	if b == nil {
		return nil, errNotFound
	}
	var a AuthorityRecord
	if err := json.Unmarshal(b, &a); err != nil {
		return nil, fmt.Errorf("GetAuthority: %w", err)
	}
	return &a, nil
}

func (c *AuthorityRegistryContract) GetAuthorityActionHistory(ctx contractapi.TransactionContextInterface, authorityID string, pageSize int32, bookmark string) (*ActionPage, error) {
	if _, err := requireMSP(ctx, []string{"NHAIMSP", "RoadWatchMSP"}); err != nil {
		return nil, fmt.Errorf("GetAuthorityActionHistory: %w", err)
	}
	authorityID = strings.TrimSpace(authorityID)
	if authorityID == "" {
		return nil, fmt.Errorf("GetAuthorityActionHistory: authorityID must not be empty")
	}

	ps := normalizePageSize(pageSize)
	q := fmt.Sprintf(`{"selector":{"authorityId":"%s","logId":{"$regex":".+"}},"sort":[{"timestamp":"desc"}]}`, escapeJSON(authorityID))
	iter, meta, err := ctx.GetStub().GetQueryResultWithPagination(q, ps, bookmark)
	if err != nil {
		return nil, fmt.Errorf("GetAuthorityActionHistory: query: %w", err)
	}
	defer iter.Close()

	var out []*ActionLog
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, fmt.Errorf("GetAuthorityActionHistory: iter: %w", err)
		}
		var l ActionLog
		if err := json.Unmarshal(kv.Value, &l); err != nil {
			continue
		}
		copyL := l
		out = append(out, &copyL)
	}

	bookmarkOut := ""
	if meta != nil {
		bookmarkOut = meta.Bookmark
	}
	return &ActionPage{Actions: out, Bookmark: bookmarkOut, Count: len(out)}, nil
}

func (c *AuthorityRegistryContract) GetComplaintActionHistory(ctx contractapi.TransactionContextInterface, complaintID string) ([]*ActionLog, error) {
	complaintID = strings.TrimSpace(complaintID)
	if complaintID == "" {
		return nil, fmt.Errorf("GetComplaintActionHistory: complaintID must not be empty")
	}

	q := fmt.Sprintf(`{"selector":{"complaintId":"%s"},"sort":[{"timestamp":"asc"}]}`, escapeJSON(complaintID))
	iter, err := ctx.GetStub().GetQueryResult(q)
	if err != nil {
		return nil, fmt.Errorf("GetComplaintActionHistory: query: %w", err)
	}
	defer iter.Close()

	var out []*ActionLog
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, fmt.Errorf("GetComplaintActionHistory: iter: %w", err)
		}
		var l ActionLog
		if err := json.Unmarshal(kv.Value, &l); err != nil {
			continue
		}
		copyL := l
		out = append(out, &copyL)
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Timestamp < out[j].Timestamp })
	return out, nil
}

func (c *AuthorityRegistryContract) GetAuthoritiesByRegion(ctx contractapi.TransactionContextInterface, regionCode string) ([]*AuthorityRecord, error) {
	regionCode = strings.TrimSpace(regionCode)
	if regionCode == "" {
		return nil, fmt.Errorf("GetAuthoritiesByRegion: regionCode must not be empty")
	}

	q := fmt.Sprintf(`{"selector":{"regionCodes":{"$elemMatch":{"$eq":"%s"}},"isActive":true}}`, escapeJSON(regionCode))
	iter, err := ctx.GetStub().GetQueryResult(q)
	if err != nil {
		return nil, fmt.Errorf("GetAuthoritiesByRegion: query: %w", err)
	}
	defer iter.Close()

	var out []*AuthorityRecord
	for iter.HasNext() {
		if len(out) >= 50 {
			break
		}
		kv, err := iter.Next()
		if err != nil {
			return nil, fmt.Errorf("GetAuthoritiesByRegion: iter: %w", err)
		}
		var a AuthorityRecord
		if err := json.Unmarshal(kv.Value, &a); err != nil {
			continue
		}
		if !a.IsActive {
			continue
		}
		copyA := a
		out = append(out, &copyA)
	}
	return out, nil
}

func (c *AuthorityRegistryContract) GetInactiveAuthorities(ctx contractapi.TransactionContextInterface, regionCode string) ([]*AuthorityRecord, error) {
	if _, err := requireMSP(ctx, []string{"NHAIMSP"}); err != nil {
		return nil, fmt.Errorf("GetInactiveAuthorities: %w", err)
	}
	regionCode = strings.TrimSpace(regionCode)
	if regionCode == "" {
		return nil, fmt.Errorf("GetInactiveAuthorities: regionCode must not be empty")
	}

	q := fmt.Sprintf(`{"selector":{"regionCodes":{"$elemMatch":{"$eq":"%s"}},"isActive":false}}`, escapeJSON(regionCode))
	iter, err := ctx.GetStub().GetQueryResult(q)
	if err != nil {
		return nil, fmt.Errorf("GetInactiveAuthorities: query: %w", err)
	}
	defer iter.Close()

	var out []*AuthorityRecord
	for iter.HasNext() {
		if len(out) >= 100 {
			break
		}
		kv, err := iter.Next()
		if err != nil {
			return nil, fmt.Errorf("GetInactiveAuthorities: iter: %w", err)
		}
		var a AuthorityRecord
		if err := json.Unmarshal(kv.Value, &a); err != nil {
			continue
		}
		if a.IsActive {
			continue
		}
		copyA := a
		out = append(out, &copyA)
	}
	return out, nil
}

func (c *AuthorityRegistryContract) CalculatePerformanceScore(ctx contractapi.TransactionContextInterface, authorityID string, fromEpoch int64, toEpoch int64) (*PerformanceScore, error) {
	authorityID = strings.TrimSpace(authorityID)
	if authorityID == "" {
		return nil, fmt.Errorf("CalculatePerformanceScore: authorityID must not be empty")
	}
	if fromEpoch <= 0 {
		return nil, fmt.Errorf("CalculatePerformanceScore: fromEpoch must be > 0")
	}
	if toEpoch <= fromEpoch {
		return nil, fmt.Errorf("CalculatePerformanceScore: toEpoch must be > fromEpoch")
	}

	q := fmt.Sprintf(`{"selector":{"authorityId":"%s","timestamp":{"$gte":%d,"$lte":%d}}}`,
		escapeJSON(authorityID), fromEpoch, toEpoch,
	)
	iter, err := ctx.GetStub().GetQueryResult(q)
	if err != nil {
		return nil, fmt.Errorf("CalculatePerformanceScore: query: %w", err)
	}
	defer iter.Close()

	totalAssigned := 0
	totalResolved := 0
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, fmt.Errorf("CalculatePerformanceScore: iter: %w", err)
		}
		var l ActionLog
		if err := json.Unmarshal(kv.Value, &l); err != nil {
			continue
		}
		if l.Timestamp < fromEpoch || l.Timestamp > toEpoch {
			continue
		}
		if l.ActionType == "ACKNOWLEDGED" {
			totalAssigned++
		}
		if l.ActionType == "RESOLVED" {
			totalResolved++
		}
	}

	score := 0.0
	if totalAssigned > 0 {
		score = (float64(totalResolved) / float64(totalAssigned)) * 100.0
	}
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return nil, fmt.Errorf("CalculatePerformanceScore: %w", err)
	}

	return &PerformanceScore{
		AuthorityID:   authorityID,
		FromEpoch:     fromEpoch,
		ToEpoch:       toEpoch,
		TotalAssigned: totalAssigned,
		TotalResolved: totalResolved,
		Score:         score,
		ComputedAt:    ts,
	}, nil
}

// ---- helpers ----

var errNotFound = errors.New("not found")

func authorityKey(ctx contractapi.TransactionContextInterface, authorityID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey(KeyPrefixAuthority, []string{authorityID})
}

func actionKey(ctx contractapi.TransactionContextInterface, authorityID string, ts int64, complaintID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey(KeyPrefixAction, []string{authorityID, strconv.FormatInt(ts, 10), complaintID})
}

func validateAuthorityRecord(a *AuthorityRecord) error {
	if err := requireNotEmpty("AuthorityID", a.AuthorityID); err != nil {
		return err
	}
	if len(a.AuthorityID) > 100 {
		return fmt.Errorf("AuthorityID too long")
	}
	if err := requireNotEmpty("Name", a.Name); err != nil {
		return err
	}
	if len(a.Name) > MaxNameLength {
		return fmt.Errorf("Name too long")
	}
	if !contains(AllowedRoles, a.Role) {
		return fmt.Errorf("invalid role")
	}
	if !contains(AllowedDepartments, a.Department) {
		return fmt.Errorf("invalid department")
	}
	if len(a.RegionCodes) < 1 {
		return fmt.Errorf("RegionCodes must not be empty")
	}
	if len(a.RegionCodes) > MaxRegionCodes {
		return fmt.Errorf("too many regionCodes")
	}
	for _, rc := range a.RegionCodes {
		rc = strings.TrimSpace(rc)
		if rc == "" {
			return fmt.Errorf("invalid regionCode")
		}
		if len(rc) > 10 {
			return fmt.Errorf("regionCode too long")
		}
	}
	if len(a.RoadTypes) < 1 {
		return fmt.Errorf("RoadTypes must not be empty")
	}
	for _, rt := range a.RoadTypes {
		if !contains(AllowedRoadTypes, strings.TrimSpace(rt)) {
			return fmt.Errorf("invalid roadType")
		}
	}
	if strings.TrimSpace(a.ContactHash) != "" {
		if len(a.ContactHash) != MaxContactHashLen {
			return fmt.Errorf("invalid contactHash length")
		}
		if !contactHashRe.MatchString(a.ContactHash) {
			return fmt.Errorf("invalid contactHash")
		}
		// ensure valid hex
		if _, err := hex.DecodeString(a.ContactHash); err != nil {
			return fmt.Errorf("invalid contactHash")
		}
	}
	return nil
}

func contains(arr []string, v string) bool {
	for _, a := range arr {
		if a == v {
			return true
		}
	}
	return false
}

func requireMSP(ctx contractapi.TransactionContextInterface, allowed []string) (string, error) {
	clientID, err := cid.New(ctx.GetStub())
	if err != nil {
		return "", fmt.Errorf("get client identity: %w", err)
	}
	mspID, err := clientID.GetMSPID()
	if err != nil {
		return "", fmt.Errorf("get mspid: %w", err)
	}
	for _, a := range allowed {
		if mspID == a {
			return mspID, nil
		}
	}
	return "", fmt.Errorf("unauthorized MSP: %s", mspID)
}

func requireAdminCN(ctx contractapi.TransactionContextInterface) error {
	clientID, err := cid.New(ctx.GetStub())
	if err != nil {
		return fmt.Errorf("get client identity: %w", err)
	}
	cert, err := clientID.GetX509Certificate()
	if err != nil {
		return fmt.Errorf("get x509 certificate: %w", err)
	}
	if cert == nil {
		return errors.New("missing x509 certificate")
	}
	if !strings.Contains(cert.Subject.CommonName, "Admin") {
		return fmt.Errorf("admin required")
	}
	return nil
}

func txTimestampSeconds(ctx contractapi.TransactionContextInterface) (int64, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return 0, fmt.Errorf("get tx timestamp: %w", err)
	}
	if ts == nil {
		return 0, errors.New("missing tx timestamp")
	}
	return ts.Seconds, nil
}

func normalizePageSize(pageSize int32) int32 {
	if pageSize <= 0 {
		return defaultPageSize
	}
	if pageSize > maxPageSize {
		return maxPageSize
	}
	return pageSize
}

func requireNotEmpty(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s must not be empty", field)
	}
	return nil
}

func stateExists(ctx contractapi.TransactionContextInterface, key string) (bool, error) {
	b, err := ctx.GetStub().GetState(key)
	if err != nil {
		return false, err
	}
	return b != nil, nil
}

func putJSON(ctx contractapi.TransactionContextInterface, key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(key, b)
}

func escapeJSON(s string) string {
	r := strings.ReplaceAll(s, "\\", "\\\\")
	r = strings.ReplaceAll(r, "\"", "\\\"")
	return r
}

func emitEvent(ctx contractapi.TransactionContextInterface, eventName string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	return ctx.GetStub().SetEvent(eventName, b)
}

// deterministicHashID is used only to keep IDs reproducible in tests if needed.
func deterministicHashID(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// newQueryResponseMetadata sets fetched records count via reflection (proto field may not be exported).
func newQueryResponseMetadata(count int, bookmark string) *peer.QueryResponseMetadata {
	meta := &peer.QueryResponseMetadata{Bookmark: bookmark}
	v := reflect.ValueOf(meta).Elem().FieldByName("FetchedRecordsCount")
	if v.IsValid() && v.CanSet() {
		switch v.Kind() {
		case reflect.Int32, reflect.Int, reflect.Int64:
			v.SetInt(int64(count))
		case reflect.Uint32, reflect.Uint, reflect.Uint64:
			v.SetUint(uint64(count))
		}
	}
	return meta
}

func main() {
	cc, err := contractapi.NewChaincode(&AuthorityRegistryContract{})
	if err != nil {
		panic(err)
	}
	if err := cc.Start(); err != nil {
		panic(err)
	}
}
