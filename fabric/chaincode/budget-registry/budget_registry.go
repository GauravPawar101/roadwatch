package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/hyperledger/fabric-chaincode-go/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/hyperledger/fabric-protos-go/peer"
)

type BudgetSanction struct {
	SanctionID       string `json:"sanctionId"`
	RoadID           string `json:"roadId"`
	FiscalYear       string `json:"fiscalYear"`
	AmountSanctioned int64  `json:"amountSanctioned"`
	CurrencyCode     string `json:"currencyCode"`
	SourceMinistry   string `json:"sourceMinistry"`
	SanctionedBy     string `json:"sanctionedBy"`
	TxID             string `json:"txId"`
	Timestamp        int64  `json:"timestamp"`
}

type BudgetRelease struct {
	ReleaseID      string `json:"releaseId"`
	RoadID         string `json:"roadId"`
	SanctionID     string `json:"sanctionId"`
	AmountReleased int64  `json:"amountReleased"`
	Tranche        int    `json:"tranche"`
	ReleasedBy     string `json:"releasedBy"`
	TxID           string `json:"txId"`
	Timestamp      int64  `json:"timestamp"`
}

type ExpenditureRecord struct {
	ExpenditureID   string `json:"expenditureId"`
	RoadID          string `json:"roadId"`
	ReleaseID       string `json:"releaseId"`
	AmountSpent     int64  `json:"amountSpent"`
	WorkDescription string `json:"workDescription"`
	ContractorID    string `json:"contractorId"`
	SpentBy         string `json:"spentBy"`
	TxID            string `json:"txId"`
	Timestamp       int64  `json:"timestamp"`
}

type BudgetSummary struct {
	RoadID          string   `json:"roadId"`
	TotalSanctioned int64    `json:"totalSanctioned"`
	TotalReleased   int64    `json:"totalReleased"`
	TotalSpent      int64    `json:"totalSpent"`
	UtilizationPct  float64  `json:"utilizationPct"`
	AnomalyFlags    []string `json:"anomalyFlags"`
	LastUpdated     int64    `json:"lastUpdated"`
}

type BudgetHistoryItem struct {
	Type      string      `json:"type"`
	Timestamp int64       `json:"timestamp"`
	TxID      string      `json:"txId"`
	Data      interface{} `json:"data"`
}

type BudgetPage struct {
	Summaries []*BudgetSummary `json:"summaries"`
	Bookmark  string           `json:"bookmark"`
	Count     int              `json:"count"`
}

const (
	KeyPrefixSanction    = "SANCTION"
	KeyPrefixRelease     = "RELEASE"
	KeyPrefixExpenditure = "EXPENDITURE"
	KeyPrefixBudgetSum   = "BUDGETSUM"

	AnomalySpentExceedsReleased   = "SPENT_EXCEEDS_RELEASED"
	AnomalyReleaseExceedsSanction = "RELEASE_EXCEEDS_SANCTION"
	AnomalyZeroSpendAfter6Months  = "ZERO_SPEND_AFTER_6_MONTHS"
	AnomalyLowUtilization         = "LOW_UTILIZATION"

	SixMonthsSeconds  = int64(180 * 24 * 60 * 60)
	LowUtilizationPct = 30.0
	MaxWorkDescLength = 500
	MaxSourceLength   = 200

	FiscalYearPattern = `^\d{4}-\d{2}$`
)

const (
	defaultPageSize = int32(25)
	maxPageSize     = int32(100)
)

var (
	fiscalYearRe      = regexp.MustCompile(FiscalYearPattern)
	allowedCurrencies = map[string]struct{}{"INR": {}, "KES": {}, "BRL": {}, "USD": {}}
)

type BudgetRegistryContract struct {
	contractapi.Contract
}

func (c *BudgetRegistryContract) Init(stub shim.ChaincodeStubInterface) peer.Response {
	return peer.Response{Status: 200}
}

func (c *BudgetRegistryContract) Invoke(stub shim.ChaincodeStubInterface) peer.Response {
	return peer.Response{Status: 500, Message: "Invoke not supported; call contract methods directly"}
}

func (c *BudgetRegistryContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	if _, err := requireMSP(ctx, []string{"NHAIMSP"}); err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}
	if err := requireAdminCN(ctx); err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}

	seedRoad := "NH-48-IN-DL-001"
	seedSanctionID := "SAN-001"
	seedReleaseID := "REL-001"
	seedExpID := "EXP-001"

	sKey, err := sanctionKey(ctx, seedRoad, seedSanctionID)
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}
	existing, err := ctx.GetStub().GetState(sKey)
	if err != nil {
		return fmt.Errorf("InitLedger: get seed state: %w", err)
	}
	if existing != nil {
		return nil
	}

	txID := ctx.GetStub().GetTxID()
	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}

	sanction := &BudgetSanction{
		SanctionID:       seedSanctionID,
		RoadID:           seedRoad,
		FiscalYear:       "2019-20",
		AmountSanctioned: 4730000000,
		CurrencyCode:     "INR",
		SourceMinistry:   "Ministry of Road Transport and Highways",
		SanctionedBy:     "NHAIMSP",
		TxID:             txID,
		Timestamp:        ts,
	}
	if err := putJSON(ctx, sKey, sanction); err != nil {
		return fmt.Errorf("InitLedger: put sanction: %w", err)
	}

	release := &BudgetRelease{
		ReleaseID:      seedReleaseID,
		RoadID:         seedRoad,
		SanctionID:     seedSanctionID,
		AmountReleased: 1520000000,
		Tranche:        1,
		ReleasedBy:     "NHAIMSP",
		TxID:           txID,
		Timestamp:      ts,
	}
	rKey, err := releaseKey(ctx, seedRoad, seedReleaseID)
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}
	if err := putJSON(ctx, rKey, release); err != nil {
		return fmt.Errorf("InitLedger: put release: %w", err)
	}

	exp := &ExpenditureRecord{
		ExpenditureID:   seedExpID,
		RoadID:          seedRoad,
		ReleaseID:       seedReleaseID,
		AmountSpent:     1480000000,
		WorkDescription: "Initial works",
		ContractorID:    "CTR-001",
		SpentBy:         "NHAIMSP",
		TxID:            txID,
		Timestamp:       ts,
	}
	eKey, err := expenditureKey(ctx, seedRoad, seedExpID)
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}
	if err := putJSON(ctx, eKey, exp); err != nil {
		return fmt.Errorf("InitLedger: put expenditure: %w", err)
	}

	sum := &BudgetSummary{
		RoadID:          seedRoad,
		TotalSanctioned: sanction.AmountSanctioned,
		TotalReleased:   release.AmountReleased,
		TotalSpent:      exp.AmountSpent,
		LastUpdated:     ts,
	}
	recalcUtilization(sum)
	if err := updateAnomalyFlags(ctx, sum, ts); err != nil {
		return fmt.Errorf("InitLedger: anomaly check: %w", err)
	}

	sumKey, err := summaryKey(ctx, seedRoad)
	if err != nil {
		return fmt.Errorf("InitLedger: %w", err)
	}
	if err := putJSON(ctx, sumKey, sum); err != nil {
		return fmt.Errorf("InitLedger: put summary: %w", err)
	}

	return nil
}

func (c *BudgetRegistryContract) RecordSanction(ctx contractapi.TransactionContextInterface, sanctionJSON string) error {
	mspID, err := requireMSP(ctx, []string{"NHAIMSP"})
	if err != nil {
		return fmt.Errorf("RecordSanction: %w", err)
	}

	var sanction BudgetSanction
	if err := json.Unmarshal([]byte(sanctionJSON), &sanction); err != nil {
		return fmt.Errorf("RecordSanction: invalid json: %w", err)
	}

	if err := validateSanction(&sanction); err != nil {
		return fmt.Errorf("RecordSanction: %w", err)
	}

	key, err := sanctionKey(ctx, sanction.RoadID, sanction.SanctionID)
	if err != nil {
		return fmt.Errorf("RecordSanction: %w", err)
	}
	if exists, err := stateExists(ctx, key); err != nil {
		return fmt.Errorf("RecordSanction: %w", err)
	} else if exists {
		return fmt.Errorf("RecordSanction: sanction already exists")
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("RecordSanction: %w", err)
	}
	sanction.SanctionedBy = mspID
	sanction.TxID = ctx.GetStub().GetTxID()
	sanction.Timestamp = ts

	if err := putJSON(ctx, key, &sanction); err != nil {
		return fmt.Errorf("RecordSanction: put sanction: %w", err)
	}

	sum, err := loadOrCreateSummary(ctx, sanction.RoadID)
	if err != nil {
		return fmt.Errorf("RecordSanction: %w", err)
	}
	sum.TotalSanctioned += sanction.AmountSanctioned
	recalcUtilization(sum)
	sum.LastUpdated = ts
	if err := updateAnomalyFlags(ctx, sum, ts); err != nil {
		return fmt.Errorf("RecordSanction: %w", err)
	}
	if err := saveSummary(ctx, sum); err != nil {
		return fmt.Errorf("RecordSanction: %w", err)
	}

	if err := emitEvent(ctx, "BudgetSanctioned", &sanction); err != nil {
		return fmt.Errorf("RecordSanction: %w", err)
	}
	return nil
}

func (c *BudgetRegistryContract) RecordRelease(ctx contractapi.TransactionContextInterface, releaseJSON string) error {
	mspID, err := requireMSP(ctx, []string{"NHAIMSP"})
	if err != nil {
		return fmt.Errorf("RecordRelease: %w", err)
	}

	var release BudgetRelease
	if err := json.Unmarshal([]byte(releaseJSON), &release); err != nil {
		return fmt.Errorf("RecordRelease: invalid json: %w", err)
	}
	if err := validateRelease(&release); err != nil {
		return fmt.Errorf("RecordRelease: %w", err)
	}

	rKey, err := releaseKey(ctx, release.RoadID, release.ReleaseID)
	if err != nil {
		return fmt.Errorf("RecordRelease: %w", err)
	}
	if exists, err := stateExists(ctx, rKey); err != nil {
		return fmt.Errorf("RecordRelease: %w", err)
	} else if exists {
		return fmt.Errorf("RecordRelease: release already exists")
	}

	sKey, err := sanctionKey(ctx, release.RoadID, release.SanctionID)
	if err != nil {
		return fmt.Errorf("RecordRelease: %w", err)
	}
	if exists, err := stateExists(ctx, sKey); err != nil {
		return fmt.Errorf("RecordRelease: %w", err)
	} else if !exists {
		return fmt.Errorf("RecordRelease: referenced sanction not found")
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("RecordRelease: %w", err)
	}
	release.ReleasedBy = mspID
	release.TxID = ctx.GetStub().GetTxID()
	release.Timestamp = ts

	if err := putJSON(ctx, rKey, &release); err != nil {
		return fmt.Errorf("RecordRelease: put release: %w", err)
	}

	sum, err := loadOrCreateSummary(ctx, release.RoadID)
	if err != nil {
		return fmt.Errorf("RecordRelease: %w", err)
	}
	newTotalReleased := sum.TotalReleased + release.AmountReleased
	if newTotalReleased > sum.TotalSanctioned {
		sum.AnomalyFlags = addFlag(sum.AnomalyFlags, AnomalyReleaseExceedsSanction)
	}
	sum.TotalReleased = newTotalReleased
	recalcUtilization(sum)
	sum.LastUpdated = ts
	if err := updateAnomalyFlags(ctx, sum, ts); err != nil {
		return fmt.Errorf("RecordRelease: %w", err)
	}
	if err := saveSummary(ctx, sum); err != nil {
		return fmt.Errorf("RecordRelease: %w", err)
	}

	if err := emitEvent(ctx, "BudgetReleased", &release); err != nil {
		return fmt.Errorf("RecordRelease: %w", err)
	}
	return nil
}

func (c *BudgetRegistryContract) RecordExpenditure(ctx contractapi.TransactionContextInterface, expenditureJSON string) error {
	mspID, err := requireMSP(ctx, []string{"NHAIMSP", "RoadWatchMSP"})
	if err != nil {
		return fmt.Errorf("RecordExpenditure: %w", err)
	}

	var exp ExpenditureRecord
	if err := json.Unmarshal([]byte(expenditureJSON), &exp); err != nil {
		return fmt.Errorf("RecordExpenditure: invalid json: %w", err)
	}
	if err := validateExpenditure(&exp); err != nil {
		return fmt.Errorf("RecordExpenditure: %w", err)
	}

	eKey, err := expenditureKey(ctx, exp.RoadID, exp.ExpenditureID)
	if err != nil {
		return fmt.Errorf("RecordExpenditure: %w", err)
	}
	if exists, err := stateExists(ctx, eKey); err != nil {
		return fmt.Errorf("RecordExpenditure: %w", err)
	} else if exists {
		return fmt.Errorf("RecordExpenditure: expenditure already exists")
	}

	rKey, err := releaseKey(ctx, exp.RoadID, exp.ReleaseID)
	if err != nil {
		return fmt.Errorf("RecordExpenditure: %w", err)
	}
	if exists, err := stateExists(ctx, rKey); err != nil {
		return fmt.Errorf("RecordExpenditure: %w", err)
	} else if !exists {
		return fmt.Errorf("RecordExpenditure: referenced release not found")
	}

	if len(exp.WorkDescription) > MaxWorkDescLength {
		exp.WorkDescription = exp.WorkDescription[:MaxWorkDescLength]
	}

	ts, err := txTimestampSeconds(ctx)
	if err != nil {
		return fmt.Errorf("RecordExpenditure: %w", err)
	}
	exp.SpentBy = mspID
	exp.TxID = ctx.GetStub().GetTxID()
	exp.Timestamp = ts

	if err := putJSON(ctx, eKey, &exp); err != nil {
		return fmt.Errorf("RecordExpenditure: put expenditure: %w", err)
	}

	sum, err := loadOrCreateSummary(ctx, exp.RoadID)
	if err != nil {
		return fmt.Errorf("RecordExpenditure: %w", err)
	}
	newTotalSpent := sum.TotalSpent + exp.AmountSpent
	if newTotalSpent > sum.TotalReleased {
		sum.AnomalyFlags = addFlag(sum.AnomalyFlags, AnomalySpentExceedsReleased)
	}
	sum.TotalSpent = newTotalSpent
	recalcUtilization(sum)
	sum.LastUpdated = ts
	if err := updateAnomalyFlags(ctx, sum, ts); err != nil {
		return fmt.Errorf("RecordExpenditure: %w", err)
	}
	if err := saveSummary(ctx, sum); err != nil {
		return fmt.Errorf("RecordExpenditure: %w", err)
	}

	if err := emitEvent(ctx, "ExpenditureRecorded", &exp); err != nil {
		return fmt.Errorf("RecordExpenditure: %w", err)
	}
	return nil
}

func (c *BudgetRegistryContract) CheckAnomalies(ctx contractapi.TransactionContextInterface, roadID string) ([]string, error) {
	if strings.TrimSpace(roadID) == "" {
		return nil, fmt.Errorf("CheckAnomalies: roadID must not be empty")
	}
	sum, err := loadSummary(ctx, roadID)
	if err != nil {
		if errors.Is(err, errNotFound) {
			return []string{}, nil
		}
		return nil, fmt.Errorf("CheckAnomalies: %w", err)
	}
	if sum.AnomalyFlags == nil {
		return []string{}, nil
	}
	out := make([]string, len(sum.AnomalyFlags))
	copy(out, sum.AnomalyFlags)
	return out, nil
}

func (c *BudgetRegistryContract) GetBudgetSummary(ctx contractapi.TransactionContextInterface, roadID string) (*BudgetSummary, error) {
	if strings.TrimSpace(roadID) == "" {
		return nil, fmt.Errorf("GetBudgetSummary: roadID must not be empty")
	}
	sum, err := loadSummary(ctx, roadID)
	if err != nil {
		return nil, fmt.Errorf("GetBudgetSummary: %w", err)
	}
	return sum, nil
}

func (c *BudgetRegistryContract) GetBudgetHistory(ctx contractapi.TransactionContextInterface, roadID string) ([]BudgetHistoryItem, error) {
	if strings.TrimSpace(roadID) == "" {
		return nil, fmt.Errorf("GetBudgetHistory: roadID must not be empty")
	}

	sanctions, err := querySanctionsByRoad(ctx, roadID)
	if err != nil {
		return nil, fmt.Errorf("GetBudgetHistory: %w", err)
	}
	releases, err := queryReleasesByRoad(ctx, roadID)
	if err != nil {
		return nil, fmt.Errorf("GetBudgetHistory: %w", err)
	}
	exps, err := queryExpendituresByRoad(ctx, roadID)
	if err != nil {
		return nil, fmt.Errorf("GetBudgetHistory: %w", err)
	}

	items := make([]BudgetHistoryItem, 0, len(sanctions)+len(releases)+len(exps))
	for _, s := range sanctions {
		items = append(items, BudgetHistoryItem{Type: "sanction", Timestamp: s.Timestamp, TxID: s.TxID, Data: s})
	}
	for _, r := range releases {
		items = append(items, BudgetHistoryItem{Type: "release", Timestamp: r.Timestamp, TxID: r.TxID, Data: r})
	}
	for _, e := range exps {
		items = append(items, BudgetHistoryItem{Type: "expenditure", Timestamp: e.Timestamp, TxID: e.TxID, Data: e})
	}

	sort.Slice(items, func(i, j int) bool { return items[i].Timestamp < items[j].Timestamp })
	return items, nil
}

func (c *BudgetRegistryContract) GetBudgetsByFiscalYear(ctx contractapi.TransactionContextInterface, fiscalYear string, pageSize int32, bookmark string) (*BudgetPage, error) {
	if _, err := requireMSP(ctx, []string{"NHAIMSP", "RoadWatchMSP"}); err != nil {
		return nil, fmt.Errorf("GetBudgetsByFiscalYear: %w", err)
	}
	if !fiscalYearRe.MatchString(strings.TrimSpace(fiscalYear)) {
		return nil, fmt.Errorf("GetBudgetsByFiscalYear: invalid fiscalYear")
	}

	ps := normalizePageSize(pageSize)
	// Only sanctions carry fiscalYear, so this selector is sufficient.
	q := fmt.Sprintf(`{"selector":{"fiscalYear":"%s"}}`, escapeJSON(fiscalYear))
	iter, meta, err := ctx.GetStub().GetQueryResultWithPagination(q, ps, bookmark)
	if err != nil {
		return nil, fmt.Errorf("GetBudgetsByFiscalYear: query: %w", err)
	}
	defer iter.Close()

	seenRoad := map[string]struct{}{}
	var sums []*BudgetSummary
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, fmt.Errorf("GetBudgetsByFiscalYear: iter: %w", err)
		}
		var s BudgetSanction
		if err := json.Unmarshal(kv.Value, &s); err != nil {
			continue
		}
		if s.RoadID == "" {
			continue
		}
		if _, ok := seenRoad[s.RoadID]; ok {
			continue
		}
		seenRoad[s.RoadID] = struct{}{}

		sum, err := loadSummary(ctx, s.RoadID)
		if err != nil {
			// If summary missing, treat as zeroed summary for export.
			sum = &BudgetSummary{RoadID: s.RoadID}
		}
		sums = append(sums, sum)
	}

	bookmarkOut := ""
	if meta != nil {
		bookmarkOut = meta.Bookmark
	}
	return &BudgetPage{Summaries: sums, Bookmark: bookmarkOut, Count: len(sums)}, nil
}

func (c *BudgetRegistryContract) GetAnomalousRoads(ctx contractapi.TransactionContextInterface, countryCode string) ([]*BudgetSummary, error) {
	if _, err := requireMSP(ctx, []string{"NHAIMSP", "RoadWatchMSP"}); err != nil {
		return nil, fmt.Errorf("GetAnomalousRoads: %w", err)
	}
	cc := strings.TrimSpace(countryCode)
	if cc == "" {
		return nil, fmt.Errorf("GetAnomalousRoads: countryCode must not be empty")
	}

	// Only summaries carry anomalyFlags.
	q := `{"selector":{"anomalyFlags":{"$ne":[]}}}`
	iter, err := ctx.GetStub().GetQueryResult(q)
	if err != nil {
		return nil, fmt.Errorf("GetAnomalousRoads: query: %w", err)
	}
	defer iter.Close()

	var out []*BudgetSummary
	for iter.HasNext() {
		if len(out) >= 100 {
			break
		}
		kv, err := iter.Next()
		if err != nil {
			return nil, fmt.Errorf("GetAnomalousRoads: iter: %w", err)
		}
		var s BudgetSummary
		if err := json.Unmarshal(kv.Value, &s); err != nil {
			continue
		}
		if len(s.AnomalyFlags) == 0 {
			continue
		}
		if !roadMatchesCountry(s.RoadID, cc) {
			continue
		}
		copyS := s
		out = append(out, &copyS)
	}
	return out, nil
}

// ---- private helpers ----

var errNotFound = errors.New("not found")

func roadMatchesCountry(roadID, countryCode string) bool {
	roadID = strings.ToUpper(roadID)
	countryCode = strings.ToUpper(countryCode)
	if strings.Contains(roadID, "-"+countryCode+"-") {
		return true
	}
	return strings.HasPrefix(roadID, countryCode+"-")
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

func validateSanction(s *BudgetSanction) error {
	if err := requireNotEmpty("SanctionID", s.SanctionID); err != nil {
		return err
	}
	if len(s.SanctionID) > 100 {
		return fmt.Errorf("SanctionID too long")
	}
	if err := requireNotEmpty("RoadID", s.RoadID); err != nil {
		return err
	}
	fy := strings.TrimSpace(s.FiscalYear)
	if !fiscalYearRe.MatchString(fy) {
		return fmt.Errorf("invalid fiscalYear")
	}
	s.FiscalYear = fy
	if s.AmountSanctioned < 1 {
		return fmt.Errorf("AmountSanctioned must be >= 1")
	}
	if _, ok := allowedCurrencies[strings.ToUpper(strings.TrimSpace(s.CurrencyCode))]; !ok {
		return fmt.Errorf("invalid currencyCode")
	}
	s.CurrencyCode = strings.ToUpper(strings.TrimSpace(s.CurrencyCode))
	if err := requireNotEmpty("SourceMinistry", s.SourceMinistry); err != nil {
		return err
	}
	if len(s.SourceMinistry) > MaxSourceLength {
		return fmt.Errorf("SourceMinistry too long")
	}
	return nil
}

func validateRelease(r *BudgetRelease) error {
	if err := requireNotEmpty("ReleaseID", r.ReleaseID); err != nil {
		return err
	}
	if err := requireNotEmpty("RoadID", r.RoadID); err != nil {
		return err
	}
	if err := requireNotEmpty("SanctionID", r.SanctionID); err != nil {
		return err
	}
	if r.AmountReleased < 1 {
		return fmt.Errorf("AmountReleased must be >= 1")
	}
	if r.Tranche < 1 {
		return fmt.Errorf("Tranche must be >= 1")
	}
	return nil
}

func validateExpenditure(e *ExpenditureRecord) error {
	if err := requireNotEmpty("ExpenditureID", e.ExpenditureID); err != nil {
		return err
	}
	if err := requireNotEmpty("RoadID", e.RoadID); err != nil {
		return err
	}
	if err := requireNotEmpty("ReleaseID", e.ReleaseID); err != nil {
		return err
	}
	if e.AmountSpent < 1 {
		return fmt.Errorf("AmountSpent must be >= 1")
	}
	if err := requireNotEmpty("WorkDescription", e.WorkDescription); err != nil {
		return err
	}
	if err := requireNotEmpty("ContractorID", e.ContractorID); err != nil {
		return err
	}
	return nil
}

func sanctionKey(ctx contractapi.TransactionContextInterface, roadID, sanctionID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey(KeyPrefixSanction, []string{roadID, sanctionID})
}

func releaseKey(ctx contractapi.TransactionContextInterface, roadID, releaseID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey(KeyPrefixRelease, []string{roadID, releaseID})
}

func expenditureKey(ctx contractapi.TransactionContextInterface, roadID, expenditureID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey(KeyPrefixExpenditure, []string{roadID, expenditureID})
}

func summaryKey(ctx contractapi.TransactionContextInterface, roadID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey(KeyPrefixBudgetSum, []string{roadID})
}

func loadOrCreateSummary(ctx contractapi.TransactionContextInterface, roadID string) (*BudgetSummary, error) {
	sum, err := loadSummary(ctx, roadID)
	if err == nil {
		return sum, nil
	}
	if errors.Is(err, errNotFound) {
		return &BudgetSummary{RoadID: roadID, AnomalyFlags: []string{}}, nil
	}
	return nil, err
}

func loadSummary(ctx contractapi.TransactionContextInterface, roadID string) (*BudgetSummary, error) {
	k, err := summaryKey(ctx, roadID)
	if err != nil {
		return nil, err
	}
	b, err := ctx.GetStub().GetState(k)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, errNotFound
	}
	var sum BudgetSummary
	if err := json.Unmarshal(b, &sum); err != nil {
		return nil, err
	}
	return &sum, nil
}

func saveSummary(ctx contractapi.TransactionContextInterface, sum *BudgetSummary) error {
	k, err := summaryKey(ctx, sum.RoadID)
	if err != nil {
		return err
	}
	recalcUtilization(sum)
	return putJSON(ctx, k, sum)
}

func recalcUtilization(sum *BudgetSummary) {
	if sum.TotalSanctioned <= 0 {
		sum.UtilizationPct = 0
		return
	}
	sum.UtilizationPct = (float64(sum.TotalSpent) / float64(sum.TotalSanctioned)) * 100.0
}

func updateAnomalyFlags(ctx contractapi.TransactionContextInterface, sum *BudgetSummary, currentTimestamp int64) error {
	flags := make(map[string]struct{})

	if sum.TotalSpent > sum.TotalReleased {
		flags[AnomalySpentExceedsReleased] = struct{}{}
	}
	if sum.TotalReleased > sum.TotalSanctioned {
		flags[AnomalyReleaseExceedsSanction] = struct{}{}
	}

	if sum.TotalReleased > 0 && sum.TotalSpent == 0 {
		firstRelTs, ok, err := getFirstReleaseTimestamp(ctx, sum.RoadID)
		if err != nil {
			return err
		}
		if ok && currentTimestamp-firstRelTs > SixMonthsSeconds {
			flags[AnomalyZeroSpendAfter6Months] = struct{}{}
		}
	}

	if sum.TotalSanctioned > 0 && sum.UtilizationPct < LowUtilizationPct {
		firstSanTs, ok, err := getFirstSanctionTimestamp(ctx, sum.RoadID)
		if err != nil {
			return err
		}
		const twoYearsSeconds = int64(2 * 365 * 24 * 60 * 60)
		if ok && currentTimestamp-firstSanTs > twoYearsSeconds {
			flags[AnomalyLowUtilization] = struct{}{}
		}
	}

	var out []string
	for f := range flags {
		out = append(out, f)
	}
	sort.Strings(out)
	sum.AnomalyFlags = out
	return nil
}

func getFirstReleaseTimestamp(ctx contractapi.TransactionContextInterface, roadID string) (int64, bool, error) {
	iter, err := ctx.GetStub().GetStateByPartialCompositeKey(KeyPrefixRelease, []string{roadID})
	if err != nil {
		return 0, false, err
	}
	defer iter.Close()
	var min int64
	found := false
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return 0, false, err
		}
		var r BudgetRelease
		if err := json.Unmarshal(kv.Value, &r); err != nil {
			continue
		}
		if !found || r.Timestamp < min {
			min = r.Timestamp
			found = true
		}
	}
	return min, found, nil
}

func getFirstSanctionTimestamp(ctx contractapi.TransactionContextInterface, roadID string) (int64, bool, error) {
	iter, err := ctx.GetStub().GetStateByPartialCompositeKey(KeyPrefixSanction, []string{roadID})
	if err != nil {
		return 0, false, err
	}
	defer iter.Close()
	var min int64
	found := false
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return 0, false, err
		}
		var s BudgetSanction
		if err := json.Unmarshal(kv.Value, &s); err != nil {
			continue
		}
		if !found || s.Timestamp < min {
			min = s.Timestamp
			found = true
		}
	}
	return min, found, nil
}

func querySanctionsByRoad(ctx contractapi.TransactionContextInterface, roadID string) ([]*BudgetSanction, error) {
	q := fmt.Sprintf(`{"selector":{"roadId":"%s","fiscalYear":{"$regex":"%s"}}}`,
		escapeJSON(roadID),
		escapeJSON(FiscalYearPattern),
	)
	iter, err := ctx.GetStub().GetQueryResult(q)
	if err != nil {
		return nil, err
	}
	defer iter.Close()
	var out []*BudgetSanction
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, err
		}
		var s BudgetSanction
		if err := json.Unmarshal(kv.Value, &s); err != nil {
			continue
		}
		copyS := s
		out = append(out, &copyS)
	}
	return out, nil
}

func queryReleasesByRoad(ctx contractapi.TransactionContextInterface, roadID string) ([]*BudgetRelease, error) {
	q := fmt.Sprintf(`{"selector":{"roadId":"%s","tranche":{"$gte":1}}}`, escapeJSON(roadID))
	iter, err := ctx.GetStub().GetQueryResult(q)
	if err != nil {
		return nil, err
	}
	defer iter.Close()
	var out []*BudgetRelease
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, err
		}
		var r BudgetRelease
		if err := json.Unmarshal(kv.Value, &r); err != nil {
			continue
		}
		copyR := r
		out = append(out, &copyR)
	}
	return out, nil
}

func queryExpendituresByRoad(ctx contractapi.TransactionContextInterface, roadID string) ([]*ExpenditureRecord, error) {
	q := fmt.Sprintf(`{"selector":{"roadId":"%s","expenditureId":{"$regex":".+"}}}`, escapeJSON(roadID))
	iter, err := ctx.GetStub().GetQueryResult(q)
	if err != nil {
		return nil, err
	}
	defer iter.Close()
	var out []*ExpenditureRecord
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, err
		}
		var e ExpenditureRecord
		if err := json.Unmarshal(kv.Value, &e); err != nil {
			continue
		}
		copyE := e
		out = append(out, &copyE)
	}
	return out, nil
}

func addFlag(flags []string, f string) []string {
	for _, existing := range flags {
		if existing == f {
			return flags
		}
	}
	return append(flags, f)
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

func emitEvent(ctx contractapi.TransactionContextInterface, eventName string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	return ctx.GetStub().SetEvent(eventName, b)
}

func main() {
	cc, err := contractapi.NewChaincode(&BudgetRegistryContract{})
	if err != nil {
		panic(err)
	}
	if err := cc.Start(); err != nil {
		panic(err)
	}
}
