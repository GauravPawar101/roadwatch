package main

import (
	"crypto/rand"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"reflect"
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

func (t *testTxContext) GetStub() shim.ChaincodeStubInterface { return t.stub }
func (t *testTxContext) GetClientIdentity() cid.ClientIdentity { return nil }

func newTestContext(stub shim.ChaincodeStubInterface) contractapi.TransactionContextInterface {
	return &testTxContext{stub: stub}
}

type richHistoryStub struct {
	*shimtest.MockStub
	history map[string][]*queryresult.KeyModification
}

func newTestStub(t *testing.T, mspID string) *richHistoryStub {
	cc := new(GlobalRoutingContract)
	stub := shimtest.NewMockStub("global-routing", cc)
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
	sortSpec := q["sort"]
	sortField1, asc1, sortField2, asc2 := parseTwoSort(sortSpec)

	type docKV struct {
		key      string
		value    []byte
		sortVal1 any
		sortVal2 any
	}

	var docs []docKV
	for k, v := range s.State {
		var doc map[string]any
		if err := json.Unmarshal(v, &doc); err != nil {
			continue
		}
		if selector != nil {
			ok, err := selectorMatch(doc, selector)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
		}
		docs = append(docs, docKV{
			key:      k,
			value:    v,
			sortVal1: doc[sortField1],
			sortVal2: doc[sortField2],
		})
	}

	if sortField1 != "" {
		sort.SliceStable(docs, func(i, j int) bool {
			if compareEqual(docs[i].sortVal1, docs[j].sortVal1) {
				less := compareSortValues(docs[i].sortVal2, docs[j].sortVal2)
				if asc2 {
					return less
				}
				return !less
			}
			less := compareSortValues(docs[i].sortVal1, docs[j].sortVal1)
			if asc1 {
				return less
			}
			return !less
		})
	}

	out := make([]*queryresult.KV, 0, len(docs))
	for _, d := range docs {
		out = append(out, &queryresult.KV{Key: d.key, Value: d.value})
	}
	return out, nil
}

func selectorMatch(doc map[string]any, selector map[string]any) (bool, error) {
	for k, v := range selector {
		if docVal, ok := doc[k]; ok {
			if !reflect.DeepEqual(coerceJSON(docVal), coerceJSON(v)) {
				return false, nil
			}
		} else {
			return false, nil
		}
	}
	return true, nil
}

func parseTwoSort(sortSpec any) (field1 string, asc1 bool, field2 string, asc2 bool) {
	asc1, asc2 = true, true
	arr, ok := sortSpec.([]any)
	if !ok || len(arr) == 0 {
		return "", true, "", true
	}
	if len(arr) >= 1 {
		f, a := parseSortItem(arr[0])
		field1, asc1 = f, a
	}
	if len(arr) >= 2 {
		f, a := parseSortItem(arr[1])
		field2, asc2 = f, a
	}
	return
}

func parseSortItem(item any) (field string, asc bool) {
	asc = true
	m, ok := item.(map[string]any)
	if !ok || len(m) != 1 {
		return "", true
	}
	for k, v := range m {
		order, _ := v.(string)
		return k, strings.ToLower(order) != "desc"
	}
	return "", true
}

func compareEqual(a, b any) bool {
	return reflect.DeepEqual(coerceJSON(a), coerceJSON(b))
}

func compareSortValues(a, b any) bool {
	a = coerceJSON(a)
	b = coerceJSON(b)

	sA, okA := a.(string)
	sB, okB := b.(string)
	if okA && okB {
		return sA < sB
	}

	fA, okA := a.(float64)
	fB, okB := b.(float64)
	if okA && okB {
		return fA < fB
	}

	return fmt.Sprintf("%v", a) < fmt.Sprintf("%v", b)
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
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
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

func seedInitLedger(t *testing.T, stub *richHistoryStub, ctx contractapi.TransactionContextInterface, c *GlobalRoutingContract) {
	startTx(stub, "init", 1700000001)
	require.NoError(t, c.InitLedger(ctx))
	endTx(stub, "init")
}

func TestCreateRoutingRule_ValidNH_Success(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "NHAI Zone 3",
		Department:    "NHAI",
		SLADays:       7,
		EscalatesTo:   "",
		ContactHash:   "",
		CountryCode:   "IN",
	}

	startTx(stub, "tx1", 1700000002)
	err := c.CreateRoutingRule(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.NoError(t, err)
}

func TestCreateRoutingRule_InvalidRoadType_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_BAD",
		RegionCode:    "IN-DL",
		RoadType:      "BAD",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       7,
		CountryCode:   "IN",
	}

	startTx(stub, "tx1", 1700000002)
	err := c.CreateRoutingRule(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCreateRoutingRule_SLADaysZero_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       0,
		CountryCode:   "IN",
	}

	startTx(stub, "tx1", 1700000002)
	err := c.CreateRoutingRule(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCreateRoutingRule_SLADaysOver365_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       366,
		CountryCode:   "IN",
	}

	startTx(stub, "tx1", 1700000002)
	err := c.CreateRoutingRule(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCreateRoutingRule_InvalidCountryCode_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       7,
		CountryCode:   "ZZ",
	}

	startTx(stub, "tx1", 1700000002)
	err := c.CreateRoutingRule(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCreateRoutingRule_RuleIDMismatch_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_SH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       7,
		CountryCode:   "IN",
	}

	startTx(stub, "tx1", 1700000002)
	err := c.CreateRoutingRule(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCreateRoutingRule_DuplicateRule_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       7,
		CountryCode:   "IN",
	}

	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.CreateRoutingRule(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")

	startTx(stub, "tx2", 1700000003)
	err := c.CreateRoutingRule(ctx, mustJSON(t, r))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestCreateRoutingRule_WrongMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       7,
		CountryCode:   "IN",
	}

	startTx(stub, "tx1", 1700000002)
	err := c.CreateRoutingRule(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCreateRoutingRule_EmitsEvent_RoutingRuleCreated(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)
	drainEvents(stub.MockStub)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       7,
		CountryCode:   "IN",
	}

	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.CreateRoutingRule(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "RoutingRuleCreated")
}

func TestUpdateRoutingRule_ValidUpdate_IncrementsVersion(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       7,
		CountryCode:   "IN",
	}

	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.CreateRoutingRule(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")

	update := RoutingRule{
		AuthorityID:   "auth-2",
		AuthorityName: "Y",
		Department:    "NHAI",
		SLADays:       8,
		EscalatesTo:   "se-nhai-hq-001",
		ContactHash:   strings.Repeat("a", 64),
		Version:       1,
	}

	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.UpdateRoutingRule(ctx, "IN-DL_NH", mustJSON(t, update)))
	endTx(stub, "tx2")

	startTx(stub, "tx3", 1700000004)
	rr, err := c.GetRoutingRule(ctx, "IN-DL", "NH")
	endTx(stub, "tx3")
	require.NoError(t, err)
	require.Equal(t, 2, rr.Version)
	require.Equal(t, "auth-2", rr.AuthorityID)
}

func TestUpdateRoutingRule_VersionConflict_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       7,
		CountryCode:   "IN",
	}

	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.CreateRoutingRule(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")

	update := RoutingRule{
		AuthorityID:   "auth-2",
		AuthorityName: "Y",
		Department:    "NHAI",
		SLADays:       8,
		Version:       999,
	}

	startTx(stub, "tx2", 1700000003)
	err := c.UpdateRoutingRule(ctx, "IN-DL_NH", mustJSON(t, update))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestUpdateRoutingRule_CannotChangeRegionCode(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	seedInitLedger(t, stub, ctx, c)

	update := RoutingRule{
		RegionCode:    "IN-DL",
		AuthorityID:   "auth-2",
		AuthorityName: "Y",
		Department:    "NHAI",
		SLADays:       8,
		Version:       1,
	}

	startTx(stub, "tx2", 1700000003)
	err := c.UpdateRoutingRule(ctx, "IN-*_NH", mustJSON(t, update))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestUpdateRoutingRule_CannotChangeRoadType(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	seedInitLedger(t, stub, ctx, c)

	update := RoutingRule{
		RoadType:      "SH",
		AuthorityID:   "auth-2",
		AuthorityName: "Y",
		Department:    "NHAI",
		SLADays:       8,
		Version:       1,
	}

	startTx(stub, "tx2", 1700000003)
	err := c.UpdateRoutingRule(ctx, "IN-*_NH", mustJSON(t, update))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestUpdateRoutingRule_WrongMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	seedInitLedger(t, stub, ctx, c)

	// Switch identity after seeding so the failure is from UpdateRoutingRule.
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	update := RoutingRule{
		AuthorityID:   "auth-2",
		AuthorityName: "Y",
		Department:    "NHAI",
		SLADays:       8,
		Version:       1,
	}

	startTx(stub, "tx2", 1700000003)
	err := c.UpdateRoutingRule(ctx, "IN-*_NH", mustJSON(t, update))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestGetRoutingRule_ExactMatch_ReturnsRule(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       7,
		CountryCode:   "IN",
	}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.CreateRoutingRule(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")

	startTx(stub, "tx2", 1700000003)
	rr, err := c.GetRoutingRule(ctx, "IN-DL", "NH")
	endTx(stub, "tx2")
	require.NoError(t, err)
	require.Equal(t, "IN-DL_NH", rr.RuleID)
}

func TestGetRoutingRule_WildcardFallback_ReturnsRule(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	seedInitLedger(t, stub, ctx, c)

	startTx(stub, "tx2", 1700000003)
	rr, err := c.GetRoutingRule(ctx, "IN-DL", "NH")
	endTx(stub, "tx2")
	require.NoError(t, err)
	require.Equal(t, "IN-*_NH", rr.RuleID)
}

func TestGetRoutingRule_NotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	startTx(stub, "tx1", 1700000002)
	_, err := c.GetRoutingRule(ctx, "KE-NR", "NH")
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestGetAllRulesForCountry_India_ReturnsSeededRules(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	seedInitLedger(t, stub, ctx, c)

	startTx(stub, "tx2", 1700000003)
	page, err := c.GetAllRulesForCountry(ctx, "IN", 25, "")
	endTx(stub, "tx2")
	require.NoError(t, err)
	require.Len(t, page.Rules, 4)
}

func TestGetAllRulesForCountry_PageSizeEnforced(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	seedInitLedger(t, stub, ctx, c)
	drainEvents(stub.MockStub)

	for i := 0; i < 200; i++ {
		r := RoutingRule{
			RuleID:        fmt.Sprintf("IN-X%03d_NH", i),
			RegionCode:    fmt.Sprintf("IN-X%03d", i),
			RoadType:      "NH",
			AuthorityID:   fmt.Sprintf("auth-%d", i),
			AuthorityName: "X",
			Department:    "NHAI",
			SLADays:       7,
			CountryCode:   "IN",
		}
		startTx(stub, fmt.Sprintf("tx%d", i+10), 1700000100+int64(i))
		require.NoError(t, c.CreateRoutingRule(ctx, mustJSON(t, r)))
		endTx(stub, fmt.Sprintf("tx%d", i+10))
		// Consume event to avoid blocking on MockStub's bounded event channel.
		requireEvent(t, stub.MockStub, "RoutingRuleCreated")
	}

	startTx(stub, "txq", 1700009999)
	page, err := c.GetAllRulesForCountry(ctx, "IN", 1000, "")
	endTx(stub, "txq")
	require.NoError(t, err)
	require.Equal(t, 100, page.Count)
	require.Len(t, page.Rules, 100)
}

func TestGetEscalationChain_ThreeLevels_ReturnsOrderedChain(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	seedInitLedger(t, stub, ctx, c)
	drainEvents(stub.MockStub)

	// Add SE and CE rules so authorityId query can traverse 3 levels.
	se := RoutingRule{
		RuleID:        "IN-SE_NH",
		RegionCode:    "IN-SE",
		RoadType:      "NH",
		AuthorityID:   "se-nhai-hq-001",
		AuthorityName: "SE NHAI HQ",
		Department:    "NHAI",
		SLADays:       7,
		EscalatesTo:   "ce-nhai-001",
		CountryCode:   "IN",
	}
	ce := RoutingRule{
		RuleID:        "IN-CE_NH",
		RegionCode:    "IN-CE",
		RoadType:      "NH",
		AuthorityID:   "ce-nhai-001",
		AuthorityName: "CE NHAI",
		Department:    "NHAI",
		SLADays:       7,
		EscalatesTo:   "",
		CountryCode:   "IN",
	}

	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.CreateRoutingRule(ctx, mustJSON(t, se)))
	endTx(stub, "tx1")
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.CreateRoutingRule(ctx, mustJSON(t, ce)))
	endTx(stub, "tx2")
	// Consume events so the channel doesn't fill across tests.
	requireEvent(t, stub.MockStub, "RoutingRuleCreated")
	requireEvent(t, stub.MockStub, "RoutingRuleCreated")

	startTx(stub, "tx3", 1700000004)
	chain, err := c.GetEscalationChain(ctx, "IN-DL", "NH")
	endTx(stub, "tx3")
	require.NoError(t, err)
	require.Len(t, chain.Chain, 3)
	require.Equal(t, "ee-nhai-001", chain.Chain[0].AuthorityID)
	require.Equal(t, "se-nhai-hq-001", chain.Chain[1].AuthorityID)
	require.Equal(t, "ce-nhai-001", chain.Chain[2].AuthorityID)
}

func TestGetEscalationChain_NoEscalation_ReturnsSingleRule(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       7,
		EscalatesTo:   "",
		CountryCode:   "IN",
	}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.CreateRoutingRule(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")

	startTx(stub, "tx2", 1700000003)
	chain, err := c.GetEscalationChain(ctx, "IN-DL", "NH")
	endTx(stub, "tx2")
	require.NoError(t, err)
	require.Len(t, chain.Chain, 1)
}

func TestGetEscalationChain_MaxDepthLimit_StopsAt6(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	seedInitLedger(t, stub, ctx, c)
	drainEvents(stub.MockStub)

	// Create a long chain via authorityId lookups.
	prevAuthority := "se-nhai-hq-001"
	for i := 0; i < 10; i++ {
		nextAuthority := fmt.Sprintf("auth-%d", i)
		r := RoutingRule{
			RuleID:        fmt.Sprintf("IN-L%02d_NH", i),
			RegionCode:    fmt.Sprintf("IN-L%02d", i),
			RoadType:      "NH",
			AuthorityID:   prevAuthority,
			AuthorityName: fmt.Sprintf("L%d", i),
			Department:    "NHAI",
			SLADays:       7,
			EscalatesTo:   nextAuthority,
			CountryCode:   "IN",
		}
		startTx(stub, fmt.Sprintf("tx%d", i+1), 1700000100+int64(i))
		require.NoError(t, c.CreateRoutingRule(ctx, mustJSON(t, r)))
		endTx(stub, fmt.Sprintf("tx%d", i+1))
		requireEvent(t, stub.MockStub, "RoutingRuleCreated")
		prevAuthority = nextAuthority
	}

	startTx(stub, "txq", 1700000999)
	chain, err := c.GetEscalationChain(ctx, "IN-DL", "NH")
	endTx(stub, "txq")
	require.NoError(t, err)
	require.Len(t, chain.Chain, 6)
	require.Contains(t, chain.Chain[5].AuthorityName, "[MAX DEPTH REACHED]")
}

func TestGetEscalationChain_BaseRuleNotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	startTx(stub, "tx1", 1700000002)
	_, err := c.GetEscalationChain(ctx, "US-NY", "NH")
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestGetRoutingRuleHistory_AfterUpdate_ReturnsBothVersions(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	r := RoutingRule{
		RuleID:        "IN-DL_NH",
		RegionCode:    "IN-DL",
		RoadType:      "NH",
		AuthorityID:   "auth-1",
		AuthorityName: "X",
		Department:    "NHAI",
		SLADays:       7,
		CountryCode:   "IN",
	}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.CreateRoutingRule(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")

	update := RoutingRule{
		AuthorityID:   "auth-2",
		AuthorityName: "Y",
		Department:    "NHAI",
		SLADays:       8,
		Version:       1,
	}
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.UpdateRoutingRule(ctx, "IN-DL_NH", mustJSON(t, update)))
	endTx(stub, "tx2")

	startTx(stub, "tx3", 1700000004)
	h, err := c.GetRoutingRuleHistory(ctx, "IN-DL_NH")
	endTx(stub, "tx3")
	require.NoError(t, err)
	require.Len(t, h, 2)
	require.Equal(t, 1, h[0].Rule.Version)
	require.Equal(t, 2, h[1].Rule.Version)
}

func TestInitLedger_SeedsFourIndiaRules(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	seedInitLedger(t, stub, ctx, c)

	startTx(stub, "tx2", 1700000002)
	page, err := c.GetAllRulesForCountry(ctx, "IN", 25, "")
	endTx(stub, "tx2")
	require.NoError(t, err)
	require.Len(t, page.Rules, 4)
}

func TestInitLedger_SecondCall_Idempotent(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(GlobalRoutingContract)

	seedInitLedger(t, stub, ctx, c)
	countAfter := len(stub.State)

	seedInitLedger(t, stub, ctx, c)
	require.Equal(t, countAfter, len(stub.State))
}
