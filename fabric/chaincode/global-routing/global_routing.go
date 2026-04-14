package main

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/hyperledger/fabric-chaincode-go/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/hyperledger/fabric-protos-go/peer"
)

const (
	KeyPrefixRouting = "ROUTING"

	MaxSLADays         = 365
	MinSLADays         = 1
	MaxEscalationDepth = 6

	MaxRegionCodeLength = 10
	MaxAuthorityNameLen = 200

	defaultPageSize = int32(25)
	maxPageSize     = int32(100)
)

var (
	AllowedRoadTypes   = []string{"NH", "SH", "MDR", "ODR", "VR", "Urban"}
	AllowedDepartments = []string{"NHAI", "PWD", "Municipal", "RES", "Ministry"}
	AllowedCountries   = []string{"IN", "KE", "BR", "US"}
)

type RoutingRule struct {
	RuleID         string `json:"ruleId"`
	RegionCode     string `json:"regionCode"`
	RoadType       string `json:"roadType"`
	AuthorityID    string `json:"authorityId"`
	AuthorityName  string `json:"authorityName"`
	Department     string `json:"department"`
	SLADays        int    `json:"slaDays"`
	EscalatesTo    string `json:"escalatesTo"`
	ContactHash    string `json:"contactHash"`
	CountryCode    string `json:"countryCode"`
	CreatedBy      string `json:"createdBy"`
	UpdatedBy      string `json:"updatedBy"`
	ChainCreatedAt int64  `json:"chainCreatedAt"`
	ChainUpdatedAt int64  `json:"chainUpdatedAt"`
	Version        int    `json:"version"`
}

type EscalationChain struct {
	RegionCode string         `json:"regionCode"`
	RoadType   string         `json:"roadType"`
	Chain      []*RoutingRule `json:"chain"`
}

type RoutingPage struct {
	Rules    []*RoutingRule `json:"rules"`
	Bookmark string         `json:"bookmark"`
	Count    int            `json:"count"`
}

type RoutingRuleHistoryEntry struct {
	TxID      string       `json:"txId"`
	Timestamp int64        `json:"timestamp"`
	IsDelete  bool         `json:"isDelete"`
	Rule      *RoutingRule `json:"rule"`
}

type GlobalRoutingContract struct {
	contractapi.Contract
}

func (c *GlobalRoutingContract) Init(stub shim.ChaincodeStubInterface) peer.Response {
	return peer.Response{Status: 200}
}

func (c *GlobalRoutingContract) Invoke(stub shim.ChaincodeStubInterface) peer.Response {
	return peer.Response{Status: 500, Message: "Invoke not supported; call contract methods directly"}
}

func (c *GlobalRoutingContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	mspID, err := requireMSP(ctx, []string{"NHAIMSP"})
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

	seeds := []RoutingRule{
		{
			RuleID:        "IN-*_NH",
			RegionCode:    "IN-*",
			RoadType:      "NH",
			AuthorityID:   "ee-nhai-001",
			AuthorityName: "NHAI",
			Department:    "NHAI",
			SLADays:       7,
			EscalatesTo:   "se-nhai-hq-001",
			CountryCode:   "IN",
		},
		{
			RuleID:        "IN-*_SH",
			RegionCode:    "IN-*",
			RoadType:      "SH",
			AuthorityID:   "ee-pwd-001",
			AuthorityName: "State PWD",
			Department:    "PWD",
			SLADays:       15,
			EscalatesTo:   "se-pwd-state-001",
			CountryCode:   "IN",
		},
		{
			RuleID:        "IN-*_MDR",
			RegionCode:    "IN-*",
			RoadType:      "MDR",
			AuthorityID:   "ee-res-001",
			AuthorityName: "District Rural Engineering",
			Department:    "RES",
			SLADays:       21,
			EscalatesTo:   "se-res-district-001",
			CountryCode:   "IN",
		},
		{
			RuleID:        "IN-*_Urban",
			RegionCode:    "IN-*",
			RoadType:      "Urban",
			AuthorityID:   "ee-municipal-001",
			AuthorityName: "Municipal Corporation",
			Department:    "Municipal",
			SLADays:       10,
			EscalatesTo:   "commissioner-mcd-001",
			CountryCode:   "IN",
		},
	}

	for _, seed := range seeds {
		key, err := routingKey(ctx, seed.RuleID)
		if err != nil {
			return fmt.Errorf("InitLedger: %w", err)
		}
		if exists, err := stateExists(ctx, key); err != nil {
			return fmt.Errorf("InitLedger: %w", err)
		} else if exists {
			continue
		}

		seed.CreatedBy = mspID
		seed.UpdatedBy = mspID
		seed.ChainCreatedAt = ts
		seed.ChainUpdatedAt = ts
		seed.Version = 1

		if err := validateRuleForCreate(seed); err != nil {
			return fmt.Errorf("InitLedger: %w", err)
		}

		b, err := json.Marshal(seed)
		if err != nil {
			return fmt.Errorf("InitLedger: marshal: %w", err)
		}
		if err := ctx.GetStub().PutState(key, b); err != nil {
			return fmt.Errorf("InitLedger: put: %w", err)
		}
	}
	return nil
}

func (c *GlobalRoutingContract) CreateRoutingRule(ctx contractapi.TransactionContextInterface, ruleJSON string) error {
	if err := requireNotEmpty("ruleJSON", ruleJSON); err != nil {
		return fmt.Errorf("CreateRoutingRule: %w", err)
	}
	mspID, err := requireMSP(ctx, []string{"NHAIMSP"})
	if err != nil {
		return fmt.Errorf("CreateRoutingRule: %w", err)
	}

	var rule RoutingRule
	if err := json.Unmarshal([]byte(ruleJSON), &rule); err != nil {
		return fmt.Errorf("CreateRoutingRule: invalid ruleJSON: %w", err)
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("CreateRoutingRule: %w", err)
	}

	rule.CreatedBy = mspID
	rule.UpdatedBy = mspID
	rule.ChainCreatedAt = ts
	rule.ChainUpdatedAt = ts
	rule.Version = 1

	if err := validateRuleForCreate(rule); err != nil {
		return fmt.Errorf("CreateRoutingRule: %w", err)
	}

	key, err := routingKey(ctx, rule.RuleID)
	if err != nil {
		return fmt.Errorf("CreateRoutingRule: %w", err)
	}
	if exists, err := stateExists(ctx, key); err != nil {
		return fmt.Errorf("CreateRoutingRule: %w", err)
	} else if exists {
		return fmt.Errorf("CreateRoutingRule: rule already exists: %s", rule.RuleID)
	}

	b, err := json.Marshal(rule)
	if err != nil {
		return fmt.Errorf("CreateRoutingRule: marshal: %w", err)
	}
	if err := ctx.GetStub().PutState(key, b); err != nil {
		return fmt.Errorf("CreateRoutingRule: put: %w", err)
	}
	if err := emitEvent(ctx, "RoutingRuleCreated", rule); err != nil {
		return fmt.Errorf("CreateRoutingRule: %w", err)
	}
	return nil
}

func (c *GlobalRoutingContract) UpdateRoutingRule(ctx contractapi.TransactionContextInterface, ruleID string, updateJSON string) error {
	if err := requireNotEmpty("ruleID", ruleID); err != nil {
		return fmt.Errorf("UpdateRoutingRule: %w", err)
	}
	if err := requireNotEmpty("updateJSON", updateJSON); err != nil {
		return fmt.Errorf("UpdateRoutingRule: %w", err)
	}
	mspID, err := requireMSP(ctx, []string{"NHAIMSP"})
	if err != nil {
		return fmt.Errorf("UpdateRoutingRule: %w", err)
	}

	var update RoutingRule
	if err := json.Unmarshal([]byte(updateJSON), &update); err != nil {
		return fmt.Errorf("UpdateRoutingRule: invalid updateJSON: %w", err)
	}

	key, err := routingKey(ctx, ruleID)
	if err != nil {
		return fmt.Errorf("UpdateRoutingRule: %w", err)
	}
	existing, err := getRoutingRuleByKey(ctx, key)
	if err != nil {
		return fmt.Errorf("UpdateRoutingRule: %w", err)
	}
	if existing == nil {
		return fmt.Errorf("UpdateRoutingRule: rule not found: %s", ruleID)
	}

	if update.Version != existing.Version {
		return fmt.Errorf("UpdateRoutingRule: version conflict: expected %d, got %d", existing.Version, update.Version)
	}

	if update.RegionCode != "" && update.RegionCode != existing.RegionCode {
		return fmt.Errorf("UpdateRoutingRule: cannot change regionCode")
	}
	if update.RoadType != "" && update.RoadType != existing.RoadType {
		return fmt.Errorf("UpdateRoutingRule: cannot change roadType")
	}
	if update.CountryCode != "" && update.CountryCode != existing.CountryCode {
		return fmt.Errorf("UpdateRoutingRule: cannot change countryCode")
	}
	if update.RuleID != "" && update.RuleID != existing.RuleID {
		return fmt.Errorf("UpdateRoutingRule: cannot change ruleId")
	}

	updated := *existing
	updated.AuthorityID = update.AuthorityID
	updated.AuthorityName = update.AuthorityName
	updated.Department = update.Department
	updated.SLADays = update.SLADays
	updated.EscalatesTo = update.EscalatesTo
	updated.ContactHash = update.ContactHash

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("UpdateRoutingRule: %w", err)
	}
	updated.ChainUpdatedAt = ts
	updated.UpdatedBy = mspID
	updated.Version = existing.Version + 1

	if err := validateRuleForUpdate(updated, *existing); err != nil {
		return fmt.Errorf("UpdateRoutingRule: %w", err)
	}

	b, err := json.Marshal(updated)
	if err != nil {
		return fmt.Errorf("UpdateRoutingRule: marshal: %w", err)
	}
	if err := ctx.GetStub().PutState(key, b); err != nil {
		return fmt.Errorf("UpdateRoutingRule: put: %w", err)
	}
	if err := emitEvent(ctx, "RoutingRuleUpdated", updated); err != nil {
		return fmt.Errorf("UpdateRoutingRule: %w", err)
	}
	return nil
}

func (c *GlobalRoutingContract) GetRoutingRule(ctx contractapi.TransactionContextInterface, regionCode string, roadType string) (*RoutingRule, error) {
	if err := validateRegionCode(regionCode); err != nil {
		return nil, fmt.Errorf("GetRoutingRule: %w", err)
	}
	if err := validateRoadType(roadType); err != nil {
		return nil, fmt.Errorf("GetRoutingRule: %w", err)
	}

	exactID := regionCode + "_" + roadType
	key, err := routingKey(ctx, exactID)
	if err != nil {
		return nil, fmt.Errorf("GetRoutingRule: %w", err)
	}
	rule, err := getRoutingRuleByKey(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("GetRoutingRule: %w", err)
	}
	if rule != nil {
		return rule, nil
	}

	country := countryFromRegion(regionCode)
	wildRegion := country + "-*"
	wildID := wildRegion + "_" + roadType
	wildKey, err := routingKey(ctx, wildID)
	if err != nil {
		return nil, fmt.Errorf("GetRoutingRule: %w", err)
	}
	rule, err = getRoutingRuleByKey(ctx, wildKey)
	if err != nil {
		return nil, fmt.Errorf("GetRoutingRule: %w", err)
	}
	if rule == nil {
		return nil, fmt.Errorf("GetRoutingRule: rule not found for %s/%s", regionCode, roadType)
	}
	return rule, nil
}

func (c *GlobalRoutingContract) GetRoutingRuleHistory(ctx contractapi.TransactionContextInterface, ruleID string) ([]RoutingRuleHistoryEntry, error) {
	if err := requireNotEmpty("ruleID", ruleID); err != nil {
		return nil, fmt.Errorf("GetRoutingRuleHistory: %w", err)
	}
	key, err := routingKey(ctx, ruleID)
	if err != nil {
		return nil, fmt.Errorf("GetRoutingRuleHistory: %w", err)
	}

	it, err := ctx.GetStub().GetHistoryForKey(key)
	if err != nil {
		return nil, fmt.Errorf("GetRoutingRuleHistory: get history: %w", err)
	}
	defer it.Close()

	var out []RoutingRuleHistoryEntry
	for it.HasNext() {
		mod, err := it.Next()
		if err != nil {
			return nil, fmt.Errorf("GetRoutingRuleHistory: iter: %w", err)
		}
		var rr *RoutingRule
		if !mod.IsDelete && len(mod.Value) > 0 {
			var parsed RoutingRule
			if err := json.Unmarshal(mod.Value, &parsed); err != nil {
				return nil, fmt.Errorf("GetRoutingRuleHistory: unmarshal: %w", err)
			}
			rr = &parsed
		}
		var ts int64
		if mod.Timestamp != nil {
			ts = mod.Timestamp.Seconds
		}
		out = append(out, RoutingRuleHistoryEntry{
			TxID:      mod.TxId,
			Timestamp: ts,
			IsDelete:  mod.IsDelete,
			Rule:      rr,
		})
	}
	return out, nil
}

func (c *GlobalRoutingContract) GetAllRulesForCountry(ctx contractapi.TransactionContextInterface, countryCode string, pageSize int32, bookmark string) (*RoutingPage, error) {
	if err := validateCountryCode(countryCode); err != nil {
		return nil, fmt.Errorf("GetAllRulesForCountry: %w", err)
	}
	pageSize = normalizePageSize(pageSize)

	q := fmt.Sprintf(`{"selector":{"countryCode":"%s"},"sort":[{"regionCode":"asc"},{"roadType":"asc"}]}`,
		escapeJSON(countryCode),
	)

	it, meta, err := ctx.GetStub().GetQueryResultWithPagination(q, pageSize, bookmark)
	if err != nil {
		return nil, fmt.Errorf("GetAllRulesForCountry: query: %w", err)
	}
	defer it.Close()

	var rules []*RoutingRule
	for it.HasNext() {
		kv, err := it.Next()
		if err != nil {
			return nil, fmt.Errorf("GetAllRulesForCountry: iter: %w", err)
		}
		var rr RoutingRule
		if err := json.Unmarshal(kv.Value, &rr); err != nil {
			return nil, fmt.Errorf("GetAllRulesForCountry: unmarshal: %w", err)
		}
		rules = append(rules, &rr)
	}

	count := 0
	bookmarkOut := ""
	if meta != nil {
		count = int(meta.FetchedRecordsCount)
		bookmarkOut = meta.Bookmark
	}
	return &RoutingPage{Rules: rules, Bookmark: bookmarkOut, Count: count}, nil
}

func (c *GlobalRoutingContract) GetEscalationChain(ctx contractapi.TransactionContextInterface, regionCode string, roadType string) (*EscalationChain, error) {
	base, err := c.GetRoutingRule(ctx, regionCode, roadType)
	if err != nil {
		return nil, fmt.Errorf("GetEscalationChain: %w", err)
	}

	chain := []*RoutingRule{base}
	current := base
	for len(chain) < MaxEscalationDepth {
		if strings.TrimSpace(current.EscalatesTo) == "" {
			break
		}
		next, err := findRuleByAuthorityID(ctx, current.EscalatesTo, base.CountryCode)
		if err != nil {
			return nil, fmt.Errorf("GetEscalationChain: %w", err)
		}
		if next == nil {
			break
		}
		chain = append(chain, next)
		current = next
	}

	if len(chain) >= MaxEscalationDepth {
		chain[len(chain)-1].AuthorityName = chain[len(chain)-1].AuthorityName + " [MAX DEPTH REACHED]"
	}

	return &EscalationChain{RegionCode: regionCode, RoadType: roadType, Chain: chain}, nil
}

func findRuleByAuthorityID(ctx contractapi.TransactionContextInterface, authorityID string, preferredCountry string) (*RoutingRule, error) {
	q := fmt.Sprintf(`{"selector":{"authorityId":"%s"}}`, escapeJSON(authorityID))
	it, err := ctx.GetStub().GetQueryResult(q)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer it.Close()

	var first *RoutingRule
	for it.HasNext() {
		kv, err := it.Next()
		if err != nil {
			return nil, fmt.Errorf("iter: %w", err)
		}
		var rr RoutingRule
		if err := json.Unmarshal(kv.Value, &rr); err != nil {
			return nil, fmt.Errorf("unmarshal: %w", err)
		}
		r := rr
		if first == nil {
			first = &r
		}
		if preferredCountry != "" && rr.CountryCode == preferredCountry {
			return &r, nil
		}
	}
	return first, nil
}

func routingKey(ctx contractapi.TransactionContextInterface, ruleID string) (string, error) {
	if err := requireNotEmpty("ruleId", ruleID); err != nil {
		return "", err
	}
	return ctx.GetStub().CreateCompositeKey(KeyPrefixRouting, []string{ruleID})
}

func getRoutingRuleByKey(ctx contractapi.TransactionContextInterface, key string) (*RoutingRule, error) {
	b, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, nil
	}
	var rr RoutingRule
	if err := json.Unmarshal(b, &rr); err != nil {
		return nil, err
	}
	return &rr, nil
}

func stateExists(ctx contractapi.TransactionContextInterface, key string) (bool, error) {
	b, err := ctx.GetStub().GetState(key)
	if err != nil {
		return false, err
	}
	return b != nil, nil
}

func validateRuleForCreate(rule RoutingRule) error {
	if err := validateRegionCode(rule.RegionCode); err != nil {
		return err
	}
	if err := validateRoadType(rule.RoadType); err != nil {
		return err
	}
	if err := validateCountryCode(rule.CountryCode); err != nil {
		return err
	}
	if err := requireNotEmpty("authorityId", rule.AuthorityID); err != nil {
		return err
	}
	if err := validateAuthorityName(rule.AuthorityName); err != nil {
		return err
	}
	if err := validateDepartment(rule.Department); err != nil {
		return err
	}
	if err := validateSLADays(rule.SLADays); err != nil {
		return err
	}
	if err := validateContactHash(rule.ContactHash); err != nil {
		return err
	}
	if err := requireNotEmpty("ruleId", rule.RuleID); err != nil {
		return err
	}
	if rule.RuleID != (rule.RegionCode+"_"+rule.RoadType) {
		return fmt.Errorf("ruleId mismatch")
	}
	if err := requireNotEmpty("createdBy", rule.CreatedBy); err != nil {
		return err
	}
	if rule.ChainCreatedAt <= 0 || rule.ChainUpdatedAt <= 0 {
		return errors.New("missing chain timestamps")
	}
	if rule.Version != 1 {
		return errors.New("version must start at 1")
	}
	return nil
}

func validateRuleForUpdate(updated RoutingRule, existing RoutingRule) error {
	if updated.RuleID != existing.RuleID {
		return fmt.Errorf("cannot change ruleId")
	}
	if updated.RegionCode != existing.RegionCode {
		return fmt.Errorf("cannot change regionCode")
	}
	if updated.RoadType != existing.RoadType {
		return fmt.Errorf("cannot change roadType")
	}
	if updated.CountryCode != existing.CountryCode {
		return fmt.Errorf("cannot change countryCode")
	}
	if updated.ChainCreatedAt != existing.ChainCreatedAt {
		return fmt.Errorf("cannot change chainCreatedAt")
	}

	// validate mutable + required fields
	if err := requireNotEmpty("authorityId", updated.AuthorityID); err != nil {
		return err
	}
	if err := validateAuthorityName(updated.AuthorityName); err != nil {
		return err
	}
	if err := validateDepartment(updated.Department); err != nil {
		return err
	}
	if err := validateSLADays(updated.SLADays); err != nil {
		return err
	}
	if err := validateContactHash(updated.ContactHash); err != nil {
		return err
	}
	if updated.Version <= existing.Version {
		return fmt.Errorf("invalid version")
	}
	if updated.ChainUpdatedAt <= 0 {
		return fmt.Errorf("invalid chainUpdatedAt")
	}
	if err := requireNotEmpty("updatedBy", updated.UpdatedBy); err != nil {
		return err
	}
	return nil
}

func validateRegionCode(regionCode string) error {
	if err := requireNotEmpty("regionCode", regionCode); err != nil {
		return err
	}
	if len(regionCode) > MaxRegionCodeLength {
		return fmt.Errorf("regionCode too long")
	}
	return nil
}

func validateAuthorityName(name string) error {
	if err := requireNotEmpty("authorityName", name); err != nil {
		return err
	}
	if len(name) > MaxAuthorityNameLen {
		return fmt.Errorf("authorityName too long")
	}
	return nil
}

func validateDepartment(dept string) error {
	if err := requireNotEmpty("department", dept); err != nil {
		return err
	}
	for _, d := range AllowedDepartments {
		if dept == d {
			return nil
		}
	}
	return fmt.Errorf("invalid department")
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

func validateCountryCode(country string) error {
	if err := requireNotEmpty("countryCode", country); err != nil {
		return err
	}
	for _, c := range AllowedCountries {
		if country == c {
			return nil
		}
	}
	return fmt.Errorf("invalid countryCode")
}

func validateSLADays(days int) error {
	if days < MinSLADays {
		return fmt.Errorf("slaDays too small")
	}
	if days > MaxSLADays {
		return fmt.Errorf("slaDays too large")
	}
	return nil
}

var contactHashRe = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

func validateContactHash(h string) error {
	if strings.TrimSpace(h) == "" {
		return nil
	}
	if len(h) != 64 {
		return fmt.Errorf("invalid contactHash")
	}
	if !contactHashRe.MatchString(h) {
		return fmt.Errorf("invalid contactHash")
	}
	// ensure it is valid hex
	if _, err := hex.DecodeString(h); err != nil {
		return fmt.Errorf("invalid contactHash")
	}
	return nil
}

func countryFromRegion(regionCode string) string {
	parts := strings.Split(regionCode, "-")
	if len(parts) == 0 {
		return regionCode
	}
	return parts[0]
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
	cc, err := contractapi.NewChaincode(&GlobalRoutingContract{})
	if err != nil {
		panic(err)
	}
	if err := cc.Start(); err != nil {
		panic(err)
	}
}
