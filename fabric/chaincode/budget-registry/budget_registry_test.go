package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	legacyproto "github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/hyperledger/fabric-chaincode-go/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-chaincode-go/shimtest"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/hyperledger/fabric-protos-go/ledger/queryresult"
	"github.com/hyperledger/fabric-protos-go/msp"
	"github.com/hyperledger/fabric-protos-go/peer"
	"github.com/stretchr/testify/require"
)

type testTxContext struct {
	contractapi.TransactionContextInterface
	stub shim.ChaincodeStubInterface
}

func (t *testTxContext) GetStub() shim.ChaincodeStubInterface  { return t.stub }
func (t *testTxContext) GetClientIdentity() cid.ClientIdentity { return nil }

func newTestContext(stub shim.ChaincodeStubInterface) contractapi.TransactionContextInterface {
	return &testTxContext{stub: stub}
}

type richHistoryStub struct {
	*shimtest.MockStub
	history map[string][]*queryresult.KeyModification
}

func newTestStub(t *testing.T, mspID string) *richHistoryStub {
	cc := new(BudgetRegistryContract)
	stub := shimtest.NewMockStub("budget-registry", cc)
	stub.Creator = mockCreator(t, mspID, "Test Admin")
	stub.TxID = "tx0"
	stub.TxTimestamp = &timestamp.Timestamp{Seconds: 1700000000}
	return &richHistoryStub{MockStub: stub, history: map[string][]*queryresult.KeyModification{}}
}

func startTx(stub *richHistoryStub, txID string, ts int64) {
	stub.MockTransactionStart(txID)
	stub.TxID = txID
	stub.TxTimestamp = &timestamp.Timestamp{Seconds: ts}
}

func endTx(stub *richHistoryStub, txID string) {
	stub.MockTransactionEnd(txID)
}

func (s *richHistoryStub) PutState(key string, value []byte) error {
	if err := s.MockStub.PutState(key, value); err != nil {
		return err
	}
	s.appendHistory(key, &queryresult.KeyModification{
		TxId:      s.TxID,
		Value:     value,
		Timestamp: &timestamp.Timestamp{Seconds: s.TxTimestamp.Seconds},
		IsDelete:  false,
	})
	return nil
}

func (s *richHistoryStub) DelState(key string) error {
	if err := s.MockStub.DelState(key); err != nil {
		return err
	}
	s.appendHistory(key, &queryresult.KeyModification{
		TxId:      s.TxID,
		Value:     nil,
		Timestamp: &timestamp.Timestamp{Seconds: s.TxTimestamp.Seconds},
		IsDelete:  true,
	})
	return nil
}

func (s *richHistoryStub) appendHistory(key string, mod *queryresult.KeyModification) {
	s.history[key] = append(s.history[key], mod)
}

func (s *richHistoryStub) GetHistoryForKey(key string) (shim.HistoryQueryIteratorInterface, error) {
	mods := s.history[key]
	return &historyIter{mods: mods, idx: 0}, nil
}

type historyIter struct {
	mods []*queryresult.KeyModification
	idx  int
}

func (h *historyIter) HasNext() bool { return h.idx < len(h.mods) }
func (h *historyIter) Next() (*queryresult.KeyModification, error) {
	if !h.HasNext() {
		return nil, fmt.Errorf("no more items")
	}
	v := h.mods[h.idx]
	h.idx++
	return v, nil
}
func (h *historyIter) Close() error { return nil }

func (s *richHistoryStub) GetQueryResult(query string) (shim.StateQueryIteratorInterface, error) {
	kvs, err := s.evalQuery(query)
	if err != nil {
		return nil, err
	}
	return &resultsIter{kvs: kvs, idx: 0}, nil
}

func (s *richHistoryStub) GetQueryResultWithPagination(query string, pageSize int32, bookmark string) (shim.StateQueryIteratorInterface, *peer.QueryResponseMetadata, error) {
	kvs, err := s.evalQuery(query)
	if err != nil {
		return nil, nil, err
	}

	start := 0
	if bookmark != "" {
		for i := range kvs {
			if kvs[i].Key == bookmark {
				start = i + 1
				break
			}
		}
	}

	end := start + int(pageSize)
	if end > len(kvs) {
		end = len(kvs)
	}
	page := kvs[start:end]

	nextBookmark := ""
	if end < len(kvs) && len(page) > 0 {
		nextBookmark = page[len(page)-1].Key
	}

	meta := newQueryResponseMetadata(len(page), nextBookmark)
	return &resultsIter{kvs: page, idx: 0}, meta, nil
}

type resultsIter struct {
	kvs []*queryresult.KV
	idx int
}

func (r *resultsIter) HasNext() bool { return r.idx < len(r.kvs) }
func (r *resultsIter) Next() (*queryresult.KV, error) {
	if !r.HasNext() {
		return nil, fmt.Errorf("no more items")
	}
	v := r.kvs[r.idx]
	r.idx++
	return v, nil
}
func (r *resultsIter) Close() error { return nil }

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

func (s *richHistoryStub) evalQuery(query string) ([]*queryresult.KV, error) {
	var q map[string]any
	if err := json.Unmarshal([]byte(query), &q); err != nil {
		return nil, fmt.Errorf("invalid query JSON: %w", err)
	}
	selector, _ := q["selector"].(map[string]any)

	type docKV struct {
		key   string
		value []byte
	}
	var docs []docKV
	for k, v := range s.State {
		var doc map[string]any
		if err := json.Unmarshal(v, &doc); err != nil {
			continue
		}
		doc["_id"] = k
		if selector != nil {
			ok, err := selectorMatch(doc, selector)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
		}
		docs = append(docs, docKV{key: k, value: v})
	}

	sort.Slice(docs, func(i, j int) bool { return docs[i].key < docs[j].key })

	out := make([]*queryresult.KV, 0, len(docs))
	for _, d := range docs {
		out = append(out, &queryresult.KV{Key: d.key, Value: d.value})
	}
	return out, nil
}

func selectorMatch(doc map[string]any, selector map[string]any) (bool, error) {
	for k, v := range selector {
		if k == "_id" {
			docID, _ := doc["_id"].(string)
			m, ok := v.(map[string]any)
			if !ok {
				return false, nil
			}
			raw, _ := m["$regex"].(string)
			if raw == "" {
				return false, nil
			}
			re, err := regexp.Compile(raw)
			if err != nil {
				return false, err
			}
			if !re.MatchString(docID) {
				return false, nil
			}
			continue
		}

		if k == "anomalyFlags" {
			// Support {"$ne": []} and {"$size": {"$gt": 0}}
			m, ok := v.(map[string]any)
			if !ok {
				return false, nil
			}
			arrAny, _ := doc[k].([]any)
			if ne, ok := m["$ne"]; ok {
				if isEmptyArrayJSON(ne) {
					if len(arrAny) == 0 {
						return false, nil
					}
					continue
				}
			}
			if size, ok := m["$size"].(map[string]any); ok {
				if gt, ok := size["$gt"].(float64); ok {
					if float64(len(arrAny)) <= gt {
						return false, nil
					}
					continue
				}
			}
			return false, nil
		}

		docVal, ok := doc[k]
		if !ok {
			return false, nil
		}

		if m, ok := v.(map[string]any); ok {
			if raw, ok := m["$regex"].(string); ok {
				re, err := regexp.Compile(raw)
				if err != nil {
					return false, err
				}
				if !re.MatchString(fmt.Sprintf("%v", docVal)) {
					return false, nil
				}
				continue
			}
			if gte, ok := m["$gte"].(float64); ok {
				n, ok := coerceJSON(docVal).(float64)
				if !ok {
					return false, nil
				}
				if n < gte {
					return false, nil
				}
				continue
			}
			if ne, ok := m["$ne"]; ok {
				if isEmptyArrayJSON(ne) {
					arrAny, _ := docVal.([]any)
					if len(arrAny) == 0 {
						return false, nil
					}
					continue
				}
				if reflect.DeepEqual(coerceJSON(docVal), coerceJSON(ne)) {
					return false, nil
				}
				continue
			}
		}

		if !reflect.DeepEqual(coerceJSON(docVal), coerceJSON(v)) {
			return false, nil
		}
	}
	return true, nil
}

func isEmptyArrayJSON(v any) bool {
	slice, ok := v.([]any)
	return ok && len(slice) == 0
}

func coerceJSON(v any) any {
	switch t := v.(type) {
	case json.Number:
		if i, err := t.Int64(); err == nil {
			return float64(i)
		}
		if f, err := t.Float64(); err == nil {
			return f
		}
	}
	return v
}

func mustJSON(t *testing.T, v any) string {
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return string(b)
}

func drainEvents(stub *shimtest.MockStub) {
	for {
		select {
		case <-stub.ChaincodeEventsChannel:
			continue
		default:
			return
		}
	}
}

func requireEvent(t *testing.T, stub *shimtest.MockStub, expected string) {
	t.Helper()
	select {
	case ev := <-stub.ChaincodeEventsChannel:
		require.Equal(t, expected, ev.EventName)
	default:
		t.Fatalf("expected event %s, got none", expected)
	}
}

func seedInitLedger(t *testing.T, stub *richHistoryStub, ctx contractapi.TransactionContextInterface, c *BudgetRegistryContract) {
	startTx(stub, "init", 1700000001)
	require.NoError(t, c.InitLedger(ctx))
	endTx(stub, "init")
}

func TestRecordSanction_ValidInput_Success(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-100", RoadID: "NH-1-IN-DL-999", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx1", 1700000002)
	err := c.RecordSanction(ctx, mustJSON(t, s))
	endTx(stub, "tx1")
	require.NoError(t, err)
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	k, _ := stub.CreateCompositeKey(KeyPrefixSanction, []string{s.RoadID, s.SanctionID})
	b, err := stub.GetState(k)
	require.NoError(t, err)
	require.NotNil(t, b)
}

func TestRecordSanction_InvalidFiscalYear_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-101", RoadID: "R1", FiscalYear: "2024/25", AmountSanctioned: 1, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx1", 1700000002)
	err := c.RecordSanction(ctx, mustJSON(t, s))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRecordSanction_ZeroAmount_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-102", RoadID: "R1", FiscalYear: "2024-25", AmountSanctioned: 0, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx1", 1700000002)
	err := c.RecordSanction(ctx, mustJSON(t, s))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRecordSanction_DuplicateSanctionID_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-103", RoadID: "R1", FiscalYear: "2024-25", AmountSanctioned: 10, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	startTx(stub, "tx2", 1700000003)
	err := c.RecordSanction(ctx, mustJSON(t, s))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestRecordSanction_WrongMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-104", RoadID: "R1", FiscalYear: "2024-25", AmountSanctioned: 10, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx1", 1700000002)
	err := c.RecordSanction(ctx, mustJSON(t, s))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRecordSanction_UpdatesBudgetSummary(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-105", RoadID: "R2", FiscalYear: "2024-25", AmountSanctioned: 200, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	sum, err := c.GetBudgetSummary(ctx, "R2")
	require.NoError(t, err)
	require.Equal(t, int64(200), sum.TotalSanctioned)
	require.Equal(t, float64(0), sum.UtilizationPct)
}

func TestRecordSanction_EmitsEvent_BudgetSanctioned(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-106", RoadID: "R3", FiscalYear: "2024-25", AmountSanctioned: 1, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")
}

func TestRecordRelease_ValidInput_Success(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-200", RoadID: "R10", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-200", RoadID: "R10", SanctionID: "SAN-200", AmountReleased: 50, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	err := c.RecordRelease(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.NoError(t, err)
	requireEvent(t, stub.MockStub, "BudgetReleased")
}

func TestRecordRelease_ExceedsSanction_SetsAnomalyFlag(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-201", RoadID: "R11", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-201", RoadID: "R11", SanctionID: "SAN-201", AmountReleased: 150, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	sum, err := c.GetBudgetSummary(ctx, "R11")
	require.NoError(t, err)
	require.Contains(t, sum.AnomalyFlags, AnomalyReleaseExceedsSanction)
}

func TestRecordRelease_ExceedsSanction_StillRecords(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-202", RoadID: "R12", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-202", RoadID: "R12", SanctionID: "SAN-202", AmountReleased: 150, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	k, _ := stub.CreateCompositeKey(KeyPrefixRelease, []string{"R12", "REL-202"})
	b, err := stub.GetState(k)
	require.NoError(t, err)
	require.NotNil(t, b)
}

func TestRecordRelease_SanctionNotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	r := BudgetRelease{ReleaseID: "REL-203", RoadID: "R13", SanctionID: "SAN-NOT", AmountReleased: 10, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	err := c.RecordRelease(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRecordRelease_DuplicateReleaseID_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-204", RoadID: "R14", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-204", RoadID: "R14", SanctionID: "SAN-204", AmountReleased: 10, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	startTx(stub, "tx2", 1700000003)
	err := c.RecordRelease(ctx, mustJSON(t, r))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestRecordRelease_WrongMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	r := BudgetRelease{ReleaseID: "REL-205", RoadID: "R15", SanctionID: "SAN-205", AmountReleased: 10, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	err := c.RecordRelease(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRecordExpenditure_ValidInput_Success(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-300", RoadID: "R20", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-300", RoadID: "R20", SanctionID: "SAN-300", AmountReleased: 80, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	e := ExpenditureRecord{ExpenditureID: "EXP-300", RoadID: "R20", ReleaseID: "REL-300", AmountSpent: 50, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx2", 1700000003)
	err := c.RecordExpenditure(ctx, mustJSON(t, e))
	endTx(stub, "tx2")
	require.NoError(t, err)
	requireEvent(t, stub.MockStub, "ExpenditureRecorded")
}

func TestRecordExpenditure_ExceedsReleased_SetsAnomalyFlag(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-301", RoadID: "R21", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-301", RoadID: "R21", SanctionID: "SAN-301", AmountReleased: 10, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	e := ExpenditureRecord{ExpenditureID: "EXP-301", RoadID: "R21", ReleaseID: "REL-301", AmountSpent: 20, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.RecordExpenditure(ctx, mustJSON(t, e)))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "ExpenditureRecorded")

	sum, err := c.GetBudgetSummary(ctx, "R21")
	require.NoError(t, err)
	require.Contains(t, sum.AnomalyFlags, AnomalySpentExceedsReleased)
}

func TestRecordExpenditure_ExceedsReleased_StillRecords(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-302", RoadID: "R22", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-302", RoadID: "R22", SanctionID: "SAN-302", AmountReleased: 10, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	e := ExpenditureRecord{ExpenditureID: "EXP-302", RoadID: "R22", ReleaseID: "REL-302", AmountSpent: 20, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.RecordExpenditure(ctx, mustJSON(t, e)))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "ExpenditureRecorded")

	k, _ := stub.CreateCompositeKey(KeyPrefixExpenditure, []string{"R22", "EXP-302"})
	b, err := stub.GetState(k)
	require.NoError(t, err)
	require.NotNil(t, b)
}

func TestRecordExpenditure_ReleaseNotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	e := ExpenditureRecord{ExpenditureID: "EXP-303", RoadID: "R23", ReleaseID: "REL-NOT", AmountSpent: 1, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx1", 1700000002)
	err := c.RecordExpenditure(ctx, mustJSON(t, e))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRecordExpenditure_DuplicateExpenditureID_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-304", RoadID: "R24", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-304", RoadID: "R24", SanctionID: "SAN-304", AmountReleased: 10, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	e := ExpenditureRecord{ExpenditureID: "EXP-304", RoadID: "R24", ReleaseID: "REL-304", AmountSpent: 1, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.RecordExpenditure(ctx, mustJSON(t, e)))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "ExpenditureRecorded")

	startTx(stub, "tx3", 1700000004)
	err := c.RecordExpenditure(ctx, mustJSON(t, e))
	endTx(stub, "tx3")
	require.Error(t, err)
}

func TestRecordExpenditure_BothMSPsAllowed(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-305", RoadID: "R25", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-305", RoadID: "R25", SanctionID: "SAN-305", AmountReleased: 10, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	// NHAI expenditure
	e1 := ExpenditureRecord{ExpenditureID: "EXP-305A", RoadID: "R25", ReleaseID: "REL-305", AmountSpent: 1, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.RecordExpenditure(ctx, mustJSON(t, e1)))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "ExpenditureRecorded")

	// RoadWatch expenditure
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")
	e2 := ExpenditureRecord{ExpenditureID: "EXP-305B", RoadID: "R25", ReleaseID: "REL-305", AmountSpent: 1, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx3", 1700000004)
	require.NoError(t, c.RecordExpenditure(ctx, mustJSON(t, e2)))
	endTx(stub, "tx3")
	requireEvent(t, stub.MockStub, "ExpenditureRecorded")
}

func TestCheckAnomalies_NoAnomalies_ReturnsEmptySlice(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-400", RoadID: "R30", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-400", RoadID: "R30", SanctionID: "SAN-400", AmountReleased: 50, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	e := ExpenditureRecord{ExpenditureID: "EXP-400", RoadID: "R30", ReleaseID: "REL-400", AmountSpent: 10, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.RecordExpenditure(ctx, mustJSON(t, e)))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "ExpenditureRecorded")

	flags, err := c.CheckAnomalies(ctx, "R30")
	require.NoError(t, err)
	require.Empty(t, flags)
}

func TestCheckAnomalies_SpentExceedsReleased_ReturnsFlag(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-401", RoadID: "R31", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-401", RoadID: "R31", SanctionID: "SAN-401", AmountReleased: 10, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	e := ExpenditureRecord{ExpenditureID: "EXP-401", RoadID: "R31", ReleaseID: "REL-401", AmountSpent: 20, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.RecordExpenditure(ctx, mustJSON(t, e)))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "ExpenditureRecorded")

	flags, err := c.CheckAnomalies(ctx, "R31")
	require.NoError(t, err)
	require.Contains(t, flags, AnomalySpentExceedsReleased)
}

func TestCheckAnomalies_ReleaseExceedsSanction_ReturnsFlag(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-402", RoadID: "R32", FiscalYear: "2024-25", AmountSanctioned: 10, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-402", RoadID: "R32", SanctionID: "SAN-402", AmountReleased: 20, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	flags, err := c.CheckAnomalies(ctx, "R32")
	require.NoError(t, err)
	require.Contains(t, flags, AnomalyReleaseExceedsSanction)
}

func TestCheckAnomalies_ReadOnly_DoesNotModifyState(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-403", RoadID: "R33", FiscalYear: "2024-25", AmountSanctioned: 10, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	k, _ := stub.CreateCompositeKey(KeyPrefixBudgetSum, []string{"R33"})
	before, err := stub.GetState(k)
	require.NoError(t, err)
	require.NotNil(t, before)

	flags, err := c.CheckAnomalies(ctx, "R33")
	require.NoError(t, err)
	require.Empty(t, flags)

	after, err := stub.GetState(k)
	require.NoError(t, err)
	require.Equal(t, before, after)
}

func TestGetBudgetSummary_Exists_ReturnsCorrectTotals(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-500", RoadID: "R40", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-500", RoadID: "R40", SanctionID: "SAN-500", AmountReleased: 60, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	e := ExpenditureRecord{ExpenditureID: "EXP-500", RoadID: "R40", ReleaseID: "REL-500", AmountSpent: 30, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.RecordExpenditure(ctx, mustJSON(t, e)))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "ExpenditureRecorded")

	sum, err := c.GetBudgetSummary(ctx, "R40")
	require.NoError(t, err)
	require.Equal(t, int64(100), sum.TotalSanctioned)
	require.Equal(t, int64(60), sum.TotalReleased)
	require.Equal(t, int64(30), sum.TotalSpent)
}

func TestGetBudgetSummary_NotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	_, err := c.GetBudgetSummary(ctx, "NOPE")
	require.Error(t, err)
}

func TestGetBudgetSummary_UtilizationPctCalculatedCorrectly(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-501", RoadID: "R41", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-501", RoadID: "R41", SanctionID: "SAN-501", AmountReleased: 100, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	e := ExpenditureRecord{ExpenditureID: "EXP-501", RoadID: "R41", ReleaseID: "REL-501", AmountSpent: 25, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.RecordExpenditure(ctx, mustJSON(t, e)))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "ExpenditureRecorded")

	sum, err := c.GetBudgetSummary(ctx, "R41")
	require.NoError(t, err)
	require.InDelta(t, 25.0, sum.UtilizationPct, 0.0001)
}

func TestGetBudgetHistory_ThreeRecordTypes_ReturnsSortedByTimestamp(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)
	drainEvents(stub.MockStub)

	s := BudgetSanction{SanctionID: "SAN-600", RoadID: "R50", FiscalYear: "2024-25", AmountSanctioned: 100, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 10)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-600", RoadID: "R50", SanctionID: "SAN-600", AmountReleased: 100, Tranche: 1}
	startTx(stub, "tx1", 20)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	e := ExpenditureRecord{ExpenditureID: "EXP-600", RoadID: "R50", ReleaseID: "REL-600", AmountSpent: 10, WorkDescription: "Work", ContractorID: "CTR"}
	startTx(stub, "tx2", 15)
	require.NoError(t, c.RecordExpenditure(ctx, mustJSON(t, e)))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "ExpenditureRecorded")

	h, err := c.GetBudgetHistory(ctx, "R50")
	require.NoError(t, err)
	require.Len(t, h, 3)
	require.Equal(t, "sanction", h[0].Type)
	require.Equal(t, "expenditure", h[1].Type)
	require.Equal(t, "release", h[2].Type)
	require.True(t, h[0].Timestamp <= h[1].Timestamp && h[1].Timestamp <= h[2].Timestamp)
}

func TestGetBudgetHistory_EmptyRoad_ReturnsEmptySlice(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	h, err := c.GetBudgetHistory(ctx, "EMPTY")
	require.NoError(t, err)
	require.Empty(t, h)
}

func TestGetBudgetsByFiscalYear_InvalidPattern_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	_, err := c.GetBudgetsByFiscalYear(ctx, "2024/25", 10, "")
	require.Error(t, err)
}

func TestGetBudgetsByFiscalYear_ValidYear_ReturnsResults(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s1 := BudgetSanction{SanctionID: "SAN-700", RoadID: "NH-48-IN-DL-001", FiscalYear: "2024-25", AmountSanctioned: 1, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	s2 := BudgetSanction{SanctionID: "SAN-701", RoadID: "NH-1-IN-DL-002", FiscalYear: "2024-25", AmountSanctioned: 1, CurrencyCode: "INR", SourceMinistry: "MoRTH"}

	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s1)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s2)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	page, err := c.GetBudgetsByFiscalYear(ctx, "2024-25", 10, "")
	require.NoError(t, err)
	require.Len(t, page.Summaries, 2)
}

func TestGetBudgetsByFiscalYear_WrongMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "OtherMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	_, err := c.GetBudgetsByFiscalYear(ctx, "2024-25", 10, "")
	require.Error(t, err)
}

func TestGetAnomalousRoads_WithAnomaly_ReturnsRoad(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	s := BudgetSanction{SanctionID: "SAN-800", RoadID: "NH-48-IN-DL-009", FiscalYear: "2024-25", AmountSanctioned: 10, CurrencyCode: "INR", SourceMinistry: "MoRTH"}
	startTx(stub, "tx0", 1700000001)
	require.NoError(t, c.RecordSanction(ctx, mustJSON(t, s)))
	endTx(stub, "tx0")
	requireEvent(t, stub.MockStub, "BudgetSanctioned")

	r := BudgetRelease{ReleaseID: "REL-800", RoadID: "NH-48-IN-DL-009", SanctionID: "SAN-800", AmountReleased: 20, Tranche: 1}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RecordRelease(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "BudgetReleased")

	res, err := c.GetAnomalousRoads(ctx, "IN")
	require.NoError(t, err)
	require.Len(t, res, 1)
	require.Equal(t, "NH-48-IN-DL-009", res[0].RoadID)
}

func TestGetAnomalousRoads_NoAnomalies_ReturnsEmpty(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	res, err := c.GetAnomalousRoads(ctx, "IN")
	require.NoError(t, err)
	require.Empty(t, res)
}

func TestInitLedger_SeedsCorrectTotals(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	seedInitLedger(t, stub, ctx, c)

	sum, err := c.GetBudgetSummary(ctx, "NH-48-IN-DL-001")
	require.NoError(t, err)
	require.Equal(t, int64(4730000000), sum.TotalSanctioned)
	require.Equal(t, int64(1520000000), sum.TotalReleased)
	require.Equal(t, int64(1480000000), sum.TotalSpent)
}

func TestInitLedger_SecondCall_Idempotent(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(BudgetRegistryContract)

	seedInitLedger(t, stub, ctx, c)
	seedInitLedger(t, stub, ctx, c)

	iter, err := stub.GetStateByPartialCompositeKey(KeyPrefixSanction, []string{"NH-48-IN-DL-001"})
	require.NoError(t, err)
	defer iter.Close()

	count := 0
	for iter.HasNext() {
		_, err := iter.Next()
		require.NoError(t, err)
		count++
	}
	require.Equal(t, 1, count)
}

// ---- identity helpers ----

func mockCreator(t *testing.T, mspID, commonName string) []byte {
	certPEM := makeCertPEM(t, commonName)
	sid := &msp.SerializedIdentity{Mspid: mspID, IdBytes: certPEM}
	b, err := legacyproto.Marshal(sid)
	require.NoError(t, err)
	return b
}

var (
	certOnce sync.Once
	certPEMs map[string][]byte
)

func makeCertPEM(t *testing.T, cn string) []byte {
	certOnce.Do(func() {
		certPEMs = map[string][]byte{}
	})
	if b, ok := certPEMs[cn]; ok {
		return b
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)

	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	require.NoError(t, err)

	var out strings.Builder
	require.NoError(t, pem.Encode(&out, &pem.Block{Type: "CERTIFICATE", Bytes: der}))
	b := []byte(out.String())
	certPEMs[cn] = b
	return b
}
