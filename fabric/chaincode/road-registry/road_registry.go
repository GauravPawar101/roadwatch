package main

import (
	"encoding/json"
	"errors"
	"fmt"
        "sort"
	"strings"

	"github.com/hyperledger/fabric-chaincode-go/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/hyperledger/fabric-protos-go/peer"
)

var AllowedRoadTypes = []string{"NH", "SH", "MDR", "ODR", "VR", "Urban"}

const (
	KeyPrefixRoad     = "ROAD"
	KeyPrefixContract = "CONTRACT"

	MaxRoadNameLength       = 200
	MaxContractorNameLength = 200
	MaxRegionCodeLength     = 10
	MaxRoadIDLength         = 100

	defaultPageSize           = int32(25)
	maxPageSize               = int32(100)
	maxContractorQueryResults = 100
)

var AllowedCurrencies = []string{"INR", "KES", "BRL", "USD"}

type RoadRecord struct {
	RoadID          string  `json:"roadId"`
	RoadType        string  `json:"roadType"`
	Name            string  `json:"name"`
	RegionCode      string  `json:"regionCode"`
	ContractorID    string  `json:"contractorId"`
	EngineerID      string  `json:"engineerId"`
	LastRelaidEpoch int64   `json:"lastRelaidEpoch"`
	ConditionScore  float64 `json:"conditionScore"`
	ChainCreatedAt  int64   `json:"chainCreatedAt"`
	ChainUpdatedAt  int64   `json:"chainUpdatedAt"`
	UpdatedBy       string  `json:"updatedBy"`
	Version         int     `json:"version"`
}

type ContractRecord struct {
	ContractID           string `json:"contractId"`
	RoadID               string `json:"roadId"`
	ContractorID         string `json:"contractorId"`
	ContractorName       string `json:"contractorName"`
	ContractValue        int64  `json:"contractValue"`
	CurrencyCode         string `json:"currencyCode"`
	ContractStartEpoch   int64  `json:"contractStartEpoch"`
	ContractEndEpoch     int64  `json:"contractEndEpoch"`
	DefectLiabilityEpoch int64  `json:"defectLiabilityEpoch"`
	AwardedBy            string `json:"awardedBy"`
	ChainCreatedAt       int64  `json:"chainCreatedAt"`
}

type RoadHistoryEntry struct {
	TxID      string      `json:"txId"`
	Timestamp int64       `json:"timestamp"`
	IsDelete  bool        `json:"isDelete"`
	Record    *RoadRecord `json:"record"`
}

type RoadPage struct {
	Roads    []*RoadRecord `json:"roads"`
	Bookmark string        `json:"bookmark"`
	Count    int           `json:"count"`
}

type RoadRegistryContract struct {
	contractapi.Contract
}

func (c *RoadRegistryContract) Init(stub shim.ChaincodeStubInterface) peer.Response {
	return peer.Response{Status: 200}
}

func (c *RoadRegistryContract) Invoke(stub shim.ChaincodeStubInterface) peer.Response {
	return peer.Response{Status: 500, Message: "Invoke not supported; call contract methods directly"}
}

func (c *RoadRegistryContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	mspID, err := requireMSP(ctx, []string{"NHAIMSP", "RoadWatchMSP"})
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}
	if err := requireAdminCN(ctx); err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}

	seeds := []RoadRecord{
		{
			RoadID:          "NH-48-IN-DL-001",
			RoadType:        "NH",
			Name:            "NH-48 Delhi to Gurugram",
			RegionCode:      "IN-DL",
			ContractorID:    "",
			EngineerID:      "ENG-SEED-001",
			LastRelaidEpoch: 1614556800,
			ConditionScore:  23.5,
		},
		{
			RoadID:          "SH-13-IN-MH-001",
			RoadType:        "SH",
			Name:            "SH-13 Pune Ring Road",
			RegionCode:      "IN-MH",
			ContractorID:    "",
			EngineerID:      "ENG-SEED-002",
			LastRelaidEpoch: 1672531200,
			ConditionScore:  67.0,
		},
		{
			RoadID:          "MDR-44-IN-KA-001",
			RoadType:        "MDR",
			Name:            "MDR-44 Bengaluru South",
			RegionCode:      "IN-KA",
			ContractorID:    "",
			EngineerID:      "ENG-SEED-003",
			LastRelaidEpoch: 1640995200,
			ConditionScore:  45.5,
		},
	}

	for _, seed := range seeds {
		key, err := roadKey(ctx, seed.RoadID)
		if err != nil {
			return fmt.Errorf("InitLedger: %w", err)
		}
		exists, err := stateExists(ctx, key)
		if err != nil {
			return fmt.Errorf("InitLedger: %w", err)
		}
		if exists {
			continue
		}

		seed.ChainCreatedAt = ts
		seed.ChainUpdatedAt = ts
		seed.UpdatedBy = mspID
		seed.Version = 1

		if err := validateRoadRecord(seed); err != nil {
			return fmt.Errorf("InitLedger: %w", err)
		}

		b, err := json.Marshal(seed)
		if err != nil {
			return fmt.Errorf("InitLedger: marshal seed: %w", err)
		}
		if err := ctx.GetStub().PutState(key, b); err != nil {
			return fmt.Errorf("InitLedger: put seed: %w", err)
		}
	}

	if err := emitEvent(ctx, "LedgerInitialized", map[string]any{"timestamp": ts, "mspId": mspID}); err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}
	return nil
}

func (c *RoadRegistryContract) CreateRoad(ctx contractapi.TransactionContextInterface, roadJSON string) error {
	if err := requireNotEmpty("roadJSON", roadJSON); err != nil {
		return fmt.Errorf("CreateRoad: %w", err)
	}
	mspID, err := requireMSP(ctx, []string{"NHAIMSP", "RoadWatchMSP"})
	if err != nil {
		return fmt.Errorf("CreateRoad: %w", err)
	}

	var road RoadRecord
	if err := json.Unmarshal([]byte(roadJSON), &road); err != nil {
		return fmt.Errorf("CreateRoad: invalid roadJSON: %w", err)
	}

	if err := validateRoadCreateFields(road); err != nil {
		return fmt.Errorf("CreateRoad: %w", err)
	}

	key, err := roadKey(ctx, road.RoadID)
	if err != nil {
		return fmt.Errorf("CreateRoad: %w", err)
	}
	if exists, err := stateExists(ctx, key); err != nil {
		return fmt.Errorf("CreateRoad: %w", err)
	} else if exists {
		return fmt.Errorf("CreateRoad: road already exists: %s", road.RoadID)
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("CreateRoad: %w", err)
	}

	road.ChainCreatedAt = ts
	road.ChainUpdatedAt = ts
	road.UpdatedBy = mspID
	road.Version = 1

	if err := validateRoadRecord(road); err != nil {
		return fmt.Errorf("CreateRoad: %w", err)
	}

	b, err := json.Marshal(road)
	if err != nil {
		return fmt.Errorf("CreateRoad: marshal: %w", err)
	}
	if err := ctx.GetStub().PutState(key, b); err != nil {
		return fmt.Errorf("CreateRoad: put: %w", err)
	}
	if err := emitEvent(ctx, "RoadCreated", road); err != nil {
		return fmt.Errorf("CreateRoad: %w", err)
	}
	return nil
}

func (c *RoadRegistryContract) UpdateRoad(ctx contractapi.TransactionContextInterface, roadID string, updateJSON string) error {
	if err := requireNotEmpty("roadID", roadID); err != nil {
		return fmt.Errorf("UpdateRoad: %w", err)
	}
	if err := requireNotEmpty("updateJSON", updateJSON); err != nil {
		return fmt.Errorf("UpdateRoad: %w", err)
	}
	mspID, err := requireMSP(ctx, []string{"NHAIMSP", "RoadWatchMSP"})
	if err != nil {
		return fmt.Errorf("UpdateRoad: %w", err)
	}

	var update RoadRecord
	if err := json.Unmarshal([]byte(updateJSON), &update); err != nil {
		return fmt.Errorf("UpdateRoad: invalid updateJSON: %w", err)
	}

	key, err := roadKey(ctx, roadID)
	if err != nil {
		return fmt.Errorf("UpdateRoad: %w", err)
	}
	existing, err := getRoadByKey(ctx, key)
	if err != nil {
		return fmt.Errorf("UpdateRoad: %w", err)
	}
	if existing == nil {
		return fmt.Errorf("UpdateRoad: road not found: %s", roadID)
	}

	if update.Version != existing.Version {
		return fmt.Errorf("UpdateRoad: version conflict: expected %d, got %d", existing.Version, update.Version)
	}

	updated := *existing
	updated.Name = update.Name
	updated.RoadType = update.RoadType
	updated.RegionCode = update.RegionCode
	updated.EngineerID = update.EngineerID
	updated.LastRelaidEpoch = update.LastRelaidEpoch
	updated.ConditionScore = update.ConditionScore
	updated.ContractorID = update.ContractorID

	if err := validateRoadCreateFields(updated); err != nil {
		return fmt.Errorf("UpdateRoad: %w", err)
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("UpdateRoad: %w", err)
	}
	updated.ChainUpdatedAt = ts
	updated.UpdatedBy = mspID
	updated.Version = existing.Version + 1
	updated.ChainCreatedAt = existing.ChainCreatedAt
	updated.RoadID = existing.RoadID

	if err := validateRoadRecord(updated); err != nil {
		return fmt.Errorf("UpdateRoad: %w", err)
	}

	b, err := json.Marshal(updated)
	if err != nil {
		return fmt.Errorf("UpdateRoad: marshal: %w", err)
	}
	if err := ctx.GetStub().PutState(key, b); err != nil {
		return fmt.Errorf("UpdateRoad: put: %w", err)
	}
	if err := emitEvent(ctx, "RoadUpdated", updated); err != nil {
		return fmt.Errorf("UpdateRoad: %w", err)
	}
	return nil
}

func (c *RoadRegistryContract) AssignContractor(ctx contractapi.TransactionContextInterface, contractJSON string) error {
	if err := requireNotEmpty("contractJSON", contractJSON); err != nil {
		return fmt.Errorf("AssignContractor: %w", err)
	}
	mspID, err := requireMSP(ctx, []string{"NHAIMSP"})
	if err != nil {
		return fmt.Errorf("AssignContractor: %w", err)
	}

	var contract ContractRecord
	if err := json.Unmarshal([]byte(contractJSON), &contract); err != nil {
		return fmt.Errorf("AssignContractor: invalid contractJSON: %w", err)
	}
	if err := validateContractRecord(contract); err != nil {
		return fmt.Errorf("AssignContractor: %w", err)
	}

	roadKey, err := roadKey(ctx, contract.RoadID)
	if err != nil {
		return fmt.Errorf("AssignContractor: %w", err)
	}
	existingRoad, err := getRoadByKey(ctx, roadKey)
	if err != nil {
		return fmt.Errorf("AssignContractor: %w", err)
	}
	if existingRoad == nil {
		return fmt.Errorf("AssignContractor: road not found: %s", contract.RoadID)
	}

	contractKey, err := contractKey(ctx, contract.RoadID, contract.ContractID)
	if err != nil {
		return fmt.Errorf("AssignContractor: %w", err)
	}
	if exists, err := stateExists(ctx, contractKey); err != nil {
		return fmt.Errorf("AssignContractor: %w", err)
	} else if exists {
		return fmt.Errorf("AssignContractor: contract already exists: %s", contract.ContractID)
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("AssignContractor: %w", err)
	}
	contract.AwardedBy = mspID
	contract.ChainCreatedAt = ts

	b, err := json.Marshal(contract)
	if err != nil {
		return fmt.Errorf("AssignContractor: marshal: %w", err)
	}
	if err := ctx.GetStub().PutState(contractKey, b); err != nil {
		return fmt.Errorf("AssignContractor: put: %w", err)
	}

	updatedRoad := *existingRoad
	updatedRoad.ContractorID = contract.ContractorID
	updatedRoad.Version = existingRoad.Version + 1
	updatedRoad.ChainUpdatedAt = ts
	updatedRoad.UpdatedBy = mspID

	if err := validateRoadRecord(updatedRoad); err != nil {
		return fmt.Errorf("AssignContractor: %w", err)
	}
	roadBytes, err := json.Marshal(updatedRoad)
	if err != nil {
		return fmt.Errorf("AssignContractor: marshal road: %w", err)
	}
	if err := ctx.GetStub().PutState(roadKey, roadBytes); err != nil {
		return fmt.Errorf("AssignContractor: update road: %w", err)
	}

	if err := emitEvent(ctx, "ContractorAssigned", contract); err != nil {
		return fmt.Errorf("AssignContractor: %w", err)
	}
	return nil
}

func (c *RoadRegistryContract) UpdateConditionScore(ctx contractapi.TransactionContextInterface, roadID string, score float64) error {
	if err := requireNotEmpty("roadID", roadID); err != nil {
		return fmt.Errorf("UpdateConditionScore: %w", err)
	}
	if err := validateConditionScore(score); err != nil {
		return fmt.Errorf("UpdateConditionScore: %w", err)
	}
	mspID, err := requireMSP(ctx, []string{"RoadWatchMSP"})
	if err != nil {
		return fmt.Errorf("UpdateConditionScore: %w", err)
	}

	key, err := roadKey(ctx, roadID)
	if err != nil {
		return fmt.Errorf("UpdateConditionScore: %w", err)
	}
	existing, err := getRoadByKey(ctx, key)
	if err != nil {
		return fmt.Errorf("UpdateConditionScore: %w", err)
	}
	if existing == nil {
		return fmt.Errorf("UpdateConditionScore: road not found: %s", roadID)
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("UpdateConditionScore: %w", err)
	}

	updated := *existing
	updated.ConditionScore = score
	updated.Version = existing.Version + 1
	updated.ChainUpdatedAt = ts
	updated.UpdatedBy = mspID

	if err := validateRoadRecord(updated); err != nil {
		return fmt.Errorf("UpdateConditionScore: %w", err)
	}
	b, err := json.Marshal(updated)
	if err != nil {
		return fmt.Errorf("UpdateConditionScore: marshal: %w", err)
	}
	if err := ctx.GetStub().PutState(key, b); err != nil {
		return fmt.Errorf("UpdateConditionScore: put: %w", err)
	}

	payload := map[string]any{"roadId": roadID, "score": score, "timestamp": ts}
	if err := emitEvent(ctx, "ConditionScoreUpdated", payload); err != nil {
		return fmt.Errorf("UpdateConditionScore: %w", err)
	}
	return nil
}

func (c *RoadRegistryContract) GetRoad(ctx contractapi.TransactionContextInterface, roadID string) (*RoadRecord, error) {
	if err := requireNotEmpty("roadID", roadID); err != nil {
		return nil, fmt.Errorf("GetRoad: %w", err)
	}
	key, err := roadKey(ctx, roadID)
	if err != nil {
		return nil, fmt.Errorf("GetRoad: %w", err)
	}
	road, err := getRoadByKey(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("GetRoad: %w", err)
	}
	if road == nil {
		return nil, fmt.Errorf("GetRoad: road not found: %s", roadID)
	}
	return road, nil
}

func (c *RoadRegistryContract) GetRoadHistory(ctx contractapi.TransactionContextInterface, roadID string) ([]RoadHistoryEntry, error) {
	if err := requireNotEmpty("roadID", roadID); err != nil {
		return nil, fmt.Errorf("GetRoadHistory: %w", err)
	}
	key, err := roadKey(ctx, roadID)
	if err != nil {
		return nil, fmt.Errorf("GetRoadHistory: %w", err)
	}

	it, err := ctx.GetStub().GetHistoryForKey(key)
	if err != nil {
		return nil, fmt.Errorf("GetRoadHistory: get history: %w", err)
	}
	defer it.Close()

	var out []RoadHistoryEntry
	for it.HasNext() {
		mod, err := it.Next()
		if err != nil {
			return nil, fmt.Errorf("GetRoadHistory: iter: %w", err)
		}
		var rr *RoadRecord
		if !mod.IsDelete && len(mod.Value) > 0 {
			var parsed RoadRecord
			if err := json.Unmarshal(mod.Value, &parsed); err != nil {
				return nil, fmt.Errorf("GetRoadHistory: unmarshal: %w", err)
			}
			rr = &parsed
		}
		var ts int64
		if mod.Timestamp != nil {
			ts = mod.Timestamp.Seconds
		}
		out = append(out, RoadHistoryEntry{
			TxID:      mod.TxId,
			Timestamp: ts,
			IsDelete:  mod.IsDelete,
			Record:    rr,
		})
	}
	return out, nil
}

func (c *RoadRegistryContract) GetContractHistory(ctx contractapi.TransactionContextInterface, roadID string) ([]ContractRecord, error) {
	if err := requireNotEmpty("roadID", roadID); err != nil {
		return nil, fmt.Errorf("GetContractHistory: %w", err)
	}

	// Use composite-key scan instead of rich query so we never accidentally
	// mix ROAD documents into contract history (both contain "roadId").
	it, err := ctx.GetStub().GetStateByPartialCompositeKey(KeyPrefixContract, []string{roadID})
	if err != nil {
		return nil, fmt.Errorf("GetContractHistory: iter: %w", err)
	}
	defer it.Close()

	var out []ContractRecord
	for it.HasNext() {
		kv, err := it.Next()
		if err != nil {
			return nil, fmt.Errorf("GetContractHistory: next: %w", err)
		}
		var rec ContractRecord
		if err := json.Unmarshal(kv.Value, &rec); err != nil {
			return nil, fmt.Errorf("GetContractHistory: unmarshal: %w", err)
		}
		out = append(out, rec)
	}

	sort.SliceStable(out, func(i, j int) bool { return out[i].ContractStartEpoch < out[j].ContractStartEpoch })
	return out, nil
}

func (c *RoadRegistryContract) QueryRoadsByRegion(ctx contractapi.TransactionContextInterface, regionCode string, pageSize int32, bookmark string) (*RoadPage, error) {
	if err := requireNotEmpty("regionCode", regionCode); err != nil {
		return nil, fmt.Errorf("QueryRoadsByRegion: %w", err)
	}
	pageSize = normalizePageSize(pageSize)

	q := fmt.Sprintf(`{"selector":{"regionCode":"%s"},"sort":[{"name":"asc"}]}`, escapeJSON(regionCode))
	it, meta, err := ctx.GetStub().GetQueryResultWithPagination(q, pageSize, bookmark)
	if err != nil {
		return nil, fmt.Errorf("QueryRoadsByRegion: query: %w", err)
	}
	defer it.Close()

	var roads []*RoadRecord
	for it.HasNext() {
		kv, err := it.Next()
		if err != nil {
			return nil, fmt.Errorf("QueryRoadsByRegion: iter: %w", err)
		}
		var rr RoadRecord
		if err := json.Unmarshal(kv.Value, &rr); err != nil {
			return nil, fmt.Errorf("QueryRoadsByRegion: unmarshal: %w", err)
		}
		roads = append(roads, &rr)
	}

	count := 0
	if meta != nil {
		count = int(meta.FetchedRecordsCount)
	}
	return &RoadPage{Roads: roads, Bookmark: meta.Bookmark, Count: count}, nil
}

func (c *RoadRegistryContract) QueryRoadsByContractor(ctx contractapi.TransactionContextInterface, contractorID string) ([]*RoadRecord, error) {
	if err := requireNotEmpty("contractorID", contractorID); err != nil {
		return nil, fmt.Errorf("QueryRoadsByContractor: %w", err)
	}

	q := fmt.Sprintf(`{"selector":{"contractorId":"%s"}}`, escapeJSON(contractorID))
	it, err := ctx.GetStub().GetQueryResult(q)
	if err != nil {
		return nil, fmt.Errorf("QueryRoadsByContractor: query: %w", err)
	}
	defer it.Close()

	var out []*RoadRecord
	for it.HasNext() {
		if len(out) >= maxContractorQueryResults {
			return nil, fmt.Errorf("QueryRoadsByContractor: result limit exceeded: %d", maxContractorQueryResults)
		}
		kv, err := it.Next()
		if err != nil {
			return nil, fmt.Errorf("QueryRoadsByContractor: iter: %w", err)
		}
		var rr RoadRecord
		if err := json.Unmarshal(kv.Value, &rr); err != nil {
			return nil, fmt.Errorf("QueryRoadsByContractor: unmarshal: %w", err)
		}
		// Contracts share "contractorId" but are not roads.
		if strings.TrimSpace(rr.RegionCode) == "" {
			continue
		}
		out = append(out, &rr)
	}
	return out, nil
}

func (c *RoadRegistryContract) IsUnderDefectLiability(ctx contractapi.TransactionContextInterface, roadID string) (bool, error) {
	if err := requireNotEmpty("roadID", roadID); err != nil {
		return false, fmt.Errorf("IsUnderDefectLiability: %w", err)
	}

	_, err := c.GetRoad(ctx, roadID)
	if err != nil {
		return false, fmt.Errorf("IsUnderDefectLiability: %w", err)
	}

	history, err := c.GetContractHistory(ctx, roadID)
	if err != nil {
		return false, fmt.Errorf("IsUnderDefectLiability: %w", err)
	}
	if len(history) == 0 {
		return false, nil
	}
	latest := history[len(history)-1]

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return false, fmt.Errorf("IsUnderDefectLiability: %w", err)
	}
	return ts <= latest.DefectLiabilityEpoch, nil
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

func roadKey(ctx contractapi.TransactionContextInterface, roadID string) (string, error) {
	if err := validateRoadID(roadID); err != nil {
		return "", err
	}
	return ctx.GetStub().CreateCompositeKey(KeyPrefixRoad, []string{roadID})
}

func contractKey(ctx contractapi.TransactionContextInterface, roadID, contractID string) (string, error) {
	if err := requireNotEmpty("roadID", roadID); err != nil {
		return "", err
	}
	if err := requireNotEmpty("contractID", contractID); err != nil {
		return "", err
	}
	return ctx.GetStub().CreateCompositeKey(KeyPrefixContract, []string{roadID, contractID})
}

func stateExists(ctx contractapi.TransactionContextInterface, key string) (bool, error) {
	b, err := ctx.GetStub().GetState(key)
	if err != nil {
		return false, err
	}
	return b != nil, nil
}

func getRoadByKey(ctx contractapi.TransactionContextInterface, key string) (*RoadRecord, error) {
	b, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, nil
	}
	var rr RoadRecord
	if err := json.Unmarshal(b, &rr); err != nil {
		return nil, err
	}
	return &rr, nil
}

func validateRoadCreateFields(road RoadRecord) error {
	if err := validateRoadID(road.RoadID); err != nil {
		return err
	}
	if err := validateRoadType(road.RoadType); err != nil {
		return err
	}
	if err := validateName(road.Name); err != nil {
		return err
	}
	if err := validateRegionCode(road.RegionCode); err != nil {
		return err
	}
	if err := validateConditionScore(road.ConditionScore); err != nil {
		return err
	}
	if road.LastRelaidEpoch < 0 {
		return fmt.Errorf("invalid lastRelaidEpoch: must be >= 0")
	}
	if err := requireNotEmpty("engineerId", road.EngineerID); err != nil {
		return err
	}
	return nil
}

func validateRoadRecord(road RoadRecord) error {
	if err := validateRoadCreateFields(road); err != nil {
		return err
	}
	if road.ChainCreatedAt <= 0 {
		return fmt.Errorf("invalid chainCreatedAt")
	}
	if road.ChainUpdatedAt <= 0 {
		return fmt.Errorf("invalid chainUpdatedAt")
	}
	if err := requireNotEmpty("updatedBy", road.UpdatedBy); err != nil {
		return err
	}
	if road.Version <= 0 {
		return fmt.Errorf("invalid version")
	}
	return nil
}

func validateContractRecord(c ContractRecord) error {
	if err := requireNotEmpty("contractId", c.ContractID); err != nil {
		return err
	}
	if err := requireNotEmpty("roadId", c.RoadID); err != nil {
		return err
	}
	if err := requireNotEmpty("contractorId", c.ContractorID); err != nil {
		return err
	}
	if err := validateContractorName(c.ContractorName); err != nil {
		return err
	}
	if c.ContractValue < 0 {
		return fmt.Errorf("invalid contractValue: must be >= 0")
	}
	if err := validateCurrency(c.CurrencyCode); err != nil {
		return err
	}
	if c.ContractStartEpoch <= 0 {
		return fmt.Errorf("invalid contractStartEpoch: must be > 0")
	}
	if c.ContractEndEpoch <= c.ContractStartEpoch {
		return fmt.Errorf("invalid contractEndEpoch: must be > contractStartEpoch")
	}
	if c.DefectLiabilityEpoch < c.ContractEndEpoch {
		return fmt.Errorf("invalid defectLiabilityEpoch: must be >= contractEndEpoch")
	}
	return nil
}

func validateRoadID(roadID string) error {
	if err := requireNotEmpty("roadId", roadID); err != nil {
		return err
	}
	if len(roadID) > MaxRoadIDLength {
		return fmt.Errorf("invalid roadId: max %d chars", MaxRoadIDLength)
	}
	return nil
}

func validateRoadType(roadType string) error {
	if err := requireNotEmpty("roadType", roadType); err != nil {
		return err
	}
	for _, t := range AllowedRoadTypes {
		if roadType == t {
			return nil
		}
	}
	return fmt.Errorf("invalid roadType")
}

func validateName(name string) error {
	if err := requireNotEmpty("name", name); err != nil {
		return err
	}
	if len(name) > MaxRoadNameLength {
		return fmt.Errorf("invalid name: max %d chars", MaxRoadNameLength)
	}
	return nil
}

func validateRegionCode(regionCode string) error {
	if err := requireNotEmpty("regionCode", regionCode); err != nil {
		return err
	}
	if len(regionCode) > MaxRegionCodeLength {
		return fmt.Errorf("invalid regionCode: max %d chars", MaxRegionCodeLength)
	}
	return nil
}

func validateContractorName(name string) error {
	if err := requireNotEmpty("contractorName", name); err != nil {
		return err
	}
	if len(name) > MaxContractorNameLength {
		return fmt.Errorf("invalid contractorName: max %d chars", MaxContractorNameLength)
	}
	return nil
}

func validateCurrency(code string) error {
	if err := requireNotEmpty("currencyCode", code); err != nil {
		return err
	}
	for _, c := range AllowedCurrencies {
		if code == c {
			return nil
		}
	}
	return fmt.Errorf("invalid currencyCode")
}

func validateConditionScore(score float64) error {
	if score < 0.0 || score > 100.0 {
		return fmt.Errorf("invalid conditionScore")
	}
	return nil
}

func requireNotEmpty(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s must not be empty", field)
	}
	return nil
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

func main() {
	chaincode, err := contractapi.NewChaincode(&RoadRegistryContract{})
	if err != nil {
		panic(err)
	}
	if err := chaincode.Start(); err != nil {
		panic(err)
	}
}
