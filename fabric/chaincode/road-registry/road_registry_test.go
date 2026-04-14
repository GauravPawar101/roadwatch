package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"reflect"
	"sort"
	"strings"
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

type richHistoryStub struct {
	*shimtest.MockStub
	history map[string][]*queryresult.KeyModification
}

func newTestStub(t *testing.T, mspID string) *richHistoryStub {
	cc := new(RoadRegistryContract)
	stub := shimtest.NewMockStub("road-registry", cc)
	stub.Creator = mockCreator(t, mspID, "Test Admin")
	stub.TxID = "tx0"
	stub.TxTimestamp = &timestamp.Timestamp{Seconds: 1700000000}

	return &richHistoryStub{MockStub: stub, history: map[string][]*queryresult.KeyModification{}}
}

func newTestContext(stub shim.ChaincodeStubInterface) contractapi.TransactionContextInterface {
	return &testTxContext{stub: stub}
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

	sortField, asc := parseSort(sortSpec)

	type docKV struct {
		key     string
		value   []byte
		sortVal any
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
		var sortVal any
		if sortField != "" {
			sortVal = doc[sortField]
		}
		docs = append(docs, docKV{key: k, value: v, sortVal: sortVal})
	}

	if sortField != "" {
		sort.SliceStable(docs, func(i, j int) bool {
			less := compareSortValues(docs[i].sortVal, docs[j].sortVal)
			if asc {
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

func parseSort(sortSpec any) (field string, asc bool) {
	arr, ok := sortSpec.([]any)
	if !ok || len(arr) == 0 {
		return "", true
	}
	m, ok := arr[0].(map[string]any)
	if !ok || len(m) != 1 {
		return "", true
	}
	for k, v := range m {
		order, _ := v.(string)
		return k, strings.ToLower(order) != "desc"
	}
	return "", true
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

func makeCertPEM(t *testing.T, cn string) []byte {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: cn,
		},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	require.NoError(t, err)

	var out strings.Builder
	require.NoError(t, pem.Encode(&out, &pem.Block{Type: "CERTIFICATE", Bytes: der}))
	return []byte(out.String())
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

func createBaseRoad(roadID string) RoadRecord {
	return RoadRecord{
		RoadID:          roadID,
		RoadType:        "NH",
		Name:            "Test Road",
		RegionCode:      "IN-DL",
		ContractorID:    "",
		EngineerID:      "ENG-1",
		LastRelaidEpoch: 0,
		ConditionScore:  50.0,
	}
}

func TestCreateRoad_ValidNH_Success(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	err := c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-999")))
	endTx(stub, "tx1")
	require.NoError(t, err)

	startTx(stub, "tx2", 1700000002)
	road, err := c.GetRoad(ctx, "NH-48-IN-DL-999")
	endTx(stub, "tx2")
	require.NoError(t, err)
	require.Equal(t, 1, road.Version)
	require.Equal(t, "RoadWatchMSP", road.UpdatedBy)
	require.Equal(t, int64(1700000001), road.ChainCreatedAt)
	require.Equal(t, int64(1700000001), road.ChainUpdatedAt)
}

func TestCreateRoad_InvalidRoadType_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	r := createBaseRoad("NH-48-IN-DL-888")
	r.RoadType = "BAD"

	startTx(stub, "tx1", 1700000001)
	err := c.CreateRoad(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCreateRoad_DuplicateRoadID_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	r := createBaseRoad("NH-48-IN-DL-777")
	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, r)))
	endTx(stub, "tx1")

	startTx(stub, "tx2", 1700000002)
	err := c.CreateRoad(ctx, mustJSON(t, r))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestCreateRoad_EmptyEngineerID_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	r := createBaseRoad("NH-48-IN-DL-776")
	r.EngineerID = ""
	startTx(stub, "tx1", 1700000001)
	err := c.CreateRoad(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCreateRoad_InvalidConditionScore_Over100_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	r := createBaseRoad("NH-48-IN-DL-775")
	r.ConditionScore = 100.01
	startTx(stub, "tx1", 1700000001)
	err := c.CreateRoad(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCreateRoad_InvalidConditionScore_Negative_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	r := createBaseRoad("NH-48-IN-DL-774")
	r.ConditionScore = -0.01
	startTx(stub, "tx1", 1700000001)
	err := c.CreateRoad(ctx, mustJSON(t, r))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCreateRoad_UnauthorizedMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "SomeOtherMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	err := c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-773")))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCreateRoad_EmitsEvent_RoadCreated(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	drainEvents(stub.MockStub)
	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-772"))))
	endTx(stub, "tx1")

	requireEvent(t, stub.MockStub, "RoadCreated")
}

func TestUpdateRoad_ValidUpdate_IncrementsVersion(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-771"))))
	endTx(stub, "tx1")

	update := createBaseRoad("NH-48-IN-DL-771")
	update.Name = "Updated"
	update.Version = 1

	startTx(stub, "tx2", 1700000002)
	require.NoError(t, c.UpdateRoad(ctx, "NH-48-IN-DL-771", mustJSON(t, update)))
	endTx(stub, "tx2")

	startTx(stub, "tx3", 1700000003)
	road, err := c.GetRoad(ctx, "NH-48-IN-DL-771")
	endTx(stub, "tx3")
	require.NoError(t, err)
	require.Equal(t, 2, road.Version)
	require.Equal(t, "Updated", road.Name)
}

func TestUpdateRoad_VersionMismatch_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-770"))))
	endTx(stub, "tx1")

	update := createBaseRoad("NH-48-IN-DL-770")
	update.Version = 999
	startTx(stub, "tx2", 1700000002)
	err := c.UpdateRoad(ctx, "NH-48-IN-DL-770", mustJSON(t, update))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestUpdateRoad_RoadNotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	update := createBaseRoad("NH-48-IN-DL-769")
	update.Version = 1
	startTx(stub, "tx1", 1700000001)
	err := c.UpdateRoad(ctx, "NH-48-IN-DL-769", mustJSON(t, update))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestUpdateRoad_RoadIDPreservedFromExisting(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-768"))))
	endTx(stub, "tx1")

	update := createBaseRoad("SOME-OTHER-ID")
	update.Name = "New Name"
	update.Version = 1

	startTx(stub, "tx2", 1700000002)
	require.NoError(t, c.UpdateRoad(ctx, "NH-48-IN-DL-768", mustJSON(t, update)))
	endTx(stub, "tx2")

	startTx(stub, "tx3", 1700000003)
	road, err := c.GetRoad(ctx, "NH-48-IN-DL-768")
	endTx(stub, "tx3")
	require.NoError(t, err)
	require.Equal(t, "NH-48-IN-DL-768", road.RoadID)
}

func TestUpdateRoad_EmitsEvent_RoadUpdated(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-767"))))
	endTx(stub, "tx1")

	drainEvents(stub.MockStub)
	update := createBaseRoad("NH-48-IN-DL-767")
	update.Name = "Updated"
	update.Version = 1

	startTx(stub, "tx2", 1700000002)
	require.NoError(t, c.UpdateRoad(ctx, "NH-48-IN-DL-767", mustJSON(t, update)))
	endTx(stub, "tx2")

	requireEvent(t, stub.MockStub, "RoadUpdated")
}

func TestAssignContractor_ValidContract_Success(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-766"))))
	endTx(stub, "tx1")

	contract := ContractRecord{
		ContractID:           "C-1",
		RoadID:               "NH-48-IN-DL-766",
		ContractorID:         "CONT-1",
		ContractorName:       "Contractor One",
		ContractValue:        1000,
		CurrencyCode:         "INR",
		ContractStartEpoch:   1700000000,
		ContractEndEpoch:     1700001000,
		DefectLiabilityEpoch: 1700002000,
	}

	startTx(stub, "tx2", 1700000002)
	require.NoError(t, c.AssignContractor(ctx, mustJSON(t, contract)))
	endTx(stub, "tx2")
}

func TestAssignContractor_EndBeforeStart_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	contract := ContractRecord{
		ContractID:           "C-1",
		RoadID:               "R-1",
		ContractorID:         "CONT-1",
		ContractorName:       "X",
		ContractValue:        0,
		CurrencyCode:         "INR",
		ContractStartEpoch:   10,
		ContractEndEpoch:     9,
		DefectLiabilityEpoch: 9,
	}
	startTx(stub, "tx1", 1700000001)
	err := c.AssignContractor(ctx, mustJSON(t, contract))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestAssignContractor_LiabilityBeforeEnd_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	contract := ContractRecord{
		ContractID:           "C-1",
		RoadID:               "R-1",
		ContractorID:         "CONT-1",
		ContractorName:       "X",
		ContractValue:        0,
		CurrencyCode:         "INR",
		ContractStartEpoch:   10,
		ContractEndEpoch:     11,
		DefectLiabilityEpoch: 10,
	}
	startTx(stub, "tx1", 1700000001)
	err := c.AssignContractor(ctx, mustJSON(t, contract))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestAssignContractor_NegativeValue_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	contract := ContractRecord{
		ContractID:           "C-1",
		RoadID:               "R-1",
		ContractorID:         "CONT-1",
		ContractorName:       "X",
		ContractValue:        -1,
		CurrencyCode:         "INR",
		ContractStartEpoch:   10,
		ContractEndEpoch:     11,
		DefectLiabilityEpoch: 11,
	}
	startTx(stub, "tx1", 1700000001)
	err := c.AssignContractor(ctx, mustJSON(t, contract))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestAssignContractor_InvalidCurrency_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	contract := ContractRecord{
		ContractID:           "C-1",
		RoadID:               "R-1",
		ContractorID:         "CONT-1",
		ContractorName:       "X",
		ContractValue:        0,
		CurrencyCode:         "XXX",
		ContractStartEpoch:   10,
		ContractEndEpoch:     11,
		DefectLiabilityEpoch: 11,
	}
	startTx(stub, "tx1", 1700000001)
	err := c.AssignContractor(ctx, mustJSON(t, contract))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestAssignContractor_RoadNotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	contract := ContractRecord{
		ContractID:           "C-1",
		RoadID:               "NOPE",
		ContractorID:         "CONT-1",
		ContractorName:       "X",
		ContractValue:        0,
		CurrencyCode:         "INR",
		ContractStartEpoch:   10,
		ContractEndEpoch:     11,
		DefectLiabilityEpoch: 11,
	}

	startTx(stub, "tx1", 1700000001)
	err := c.AssignContractor(ctx, mustJSON(t, contract))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestAssignContractor_DuplicateContractID_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-765"))))
	endTx(stub, "tx1")

	contract := ContractRecord{
		ContractID:           "C-1",
		RoadID:               "NH-48-IN-DL-765",
		ContractorID:         "CONT-1",
		ContractorName:       "X",
		ContractValue:        0,
		CurrencyCode:         "INR",
		ContractStartEpoch:   10,
		ContractEndEpoch:     11,
		DefectLiabilityEpoch: 11,
	}

	startTx(stub, "tx2", 1700000002)
	require.NoError(t, c.AssignContractor(ctx, mustJSON(t, contract)))
	endTx(stub, "tx2")

	startTx(stub, "tx3", 1700000003)
	err := c.AssignContractor(ctx, mustJSON(t, contract))
	endTx(stub, "tx3")
	require.Error(t, err)
}

func TestAssignContractor_UpdatesRoadContractorID(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-764"))))
	endTx(stub, "tx1")

	contract := ContractRecord{
		ContractID:           "C-1",
		RoadID:               "NH-48-IN-DL-764",
		ContractorID:         "CONT-XYZ",
		ContractorName:       "Contractor",
		ContractValue:        0,
		CurrencyCode:         "USD",
		ContractStartEpoch:   10,
		ContractEndEpoch:     11,
		DefectLiabilityEpoch: 11,
	}

	startTx(stub, "tx2", 1700000002)
	require.NoError(t, c.AssignContractor(ctx, mustJSON(t, contract)))
	endTx(stub, "tx2")

	startTx(stub, "tx3", 1700000003)
	road, err := c.GetRoad(ctx, "NH-48-IN-DL-764")
	endTx(stub, "tx3")
	require.NoError(t, err)
	require.Equal(t, "CONT-XYZ", road.ContractorID)
	require.Equal(t, 2, road.Version)
}

func TestAssignContractor_WrongMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	contract := ContractRecord{
		ContractID:           "C-1",
		RoadID:               "R-1",
		ContractorID:         "CONT-1",
		ContractorName:       "X",
		ContractValue:        0,
		CurrencyCode:         "INR",
		ContractStartEpoch:   10,
		ContractEndEpoch:     11,
		DefectLiabilityEpoch: 11,
	}

	startTx(stub, "tx1", 1700000001)
	err := c.AssignContractor(ctx, mustJSON(t, contract))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestUpdateConditionScore_ValidScore_Success(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-763"))))
	endTx(stub, "tx1")

	startTx(stub, "tx2", 1700000002)
	require.NoError(t, c.UpdateConditionScore(ctx, "NH-48-IN-DL-763", 99.9))
	endTx(stub, "tx2")

	startTx(stub, "tx3", 1700000003)
	road, err := c.GetRoad(ctx, "NH-48-IN-DL-763")
	endTx(stub, "tx3")
	require.NoError(t, err)
	require.Equal(t, 2, road.Version)
	require.Equal(t, 99.9, road.ConditionScore)
}

func TestUpdateConditionScore_ScoreOver100_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	err := c.UpdateConditionScore(ctx, "X", 100.01)
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestUpdateConditionScore_NegativeScore_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	err := c.UpdateConditionScore(ctx, "X", -0.01)
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestUpdateConditionScore_WrongMSP_OnlyRoadWatchAllowed(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	err := c.UpdateConditionScore(ctx, "X", 50.0)
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestUpdateConditionScore_RoadNotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	err := c.UpdateConditionScore(ctx, "NOPE", 50.0)
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestGetRoad_Exists_ReturnsRecord(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-762"))))
	endTx(stub, "tx1")

	startTx(stub, "tx2", 1700000002)
	road, err := c.GetRoad(ctx, "NH-48-IN-DL-762")
	endTx(stub, "tx2")
	require.NoError(t, err)
	require.Equal(t, "NH-48-IN-DL-762", road.RoadID)
}

func TestGetRoad_NotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	_, err := c.GetRoad(ctx, "NOPE")
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestGetRoadHistory_AfterMultipleUpdates_ReturnsAllVersions(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-761"))))
	endTx(stub, "tx1")

	u1 := createBaseRoad("NH-48-IN-DL-761")
	u1.Name = "U1"
	u1.Version = 1
	startTx(stub, "tx2", 1700000002)
	require.NoError(t, c.UpdateRoad(ctx, "NH-48-IN-DL-761", mustJSON(t, u1)))
	endTx(stub, "tx2")

	u2 := createBaseRoad("NH-48-IN-DL-761")
	u2.Name = "U2"
	u2.Version = 2
	startTx(stub, "tx3", 1700000003)
	require.NoError(t, c.UpdateRoad(ctx, "NH-48-IN-DL-761", mustJSON(t, u2)))
	endTx(stub, "tx3")

	startTx(stub, "tx4", 1700000004)
	h, err := c.GetRoadHistory(ctx, "NH-48-IN-DL-761")
	endTx(stub, "tx4")
	require.NoError(t, err)
	require.Len(t, h, 3)
	require.Equal(t, 1, h[0].Record.Version)
	require.Equal(t, 2, h[1].Record.Version)
	require.Equal(t, 3, h[2].Record.Version)
}

func TestQueryRoadsByRegion_PageSizeDefault25WhenZero(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	for i := 0; i < 30; i++ {
		r := createBaseRoad(fmt.Sprintf("NH-48-IN-DL-%03d", i))
		r.Name = fmt.Sprintf("Road %03d", i)
		startTx(stub, fmt.Sprintf("tx%d", i+1), 1700000001+int64(i))
		require.NoError(t, c.CreateRoad(ctx, mustJSON(t, r)))
		endTx(stub, fmt.Sprintf("tx%d", i+1))
		requireEvent(t, stub.MockStub, "RoadCreated")
	}

	startTx(stub, "txq", 1700000100)
	page, err := c.QueryRoadsByRegion(ctx, "IN-DL", 0, "")
	endTx(stub, "txq")
	require.NoError(t, err)
	require.Equal(t, 25, page.Count)
	require.Len(t, page.Roads, 25)
}

func TestQueryRoadsByRegion_PageSizeMax100WhenOver(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	for i := 0; i < 150; i++ {
		r := createBaseRoad(fmt.Sprintf("NH-48-IN-DL-%03d", i+100))
		r.Name = fmt.Sprintf("Road %03d", i)
		startTx(stub, fmt.Sprintf("tx%d", i+1), 1700001001+int64(i))
		require.NoError(t, c.CreateRoad(ctx, mustJSON(t, r)))
		endTx(stub, fmt.Sprintf("tx%d", i+1))
		requireEvent(t, stub.MockStub, "RoadCreated")
	}

	startTx(stub, "txq", 1700001200)
	page, err := c.QueryRoadsByRegion(ctx, "IN-DL", 1000, "")
	endTx(stub, "txq")
	require.NoError(t, err)
	require.Equal(t, 100, page.Count)
	require.Len(t, page.Roads, 100)
}

func TestIsUnderDefectLiability_WithinPeriod_ReturnsTrue(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 100)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-760"))))
	endTx(stub, "tx1")

	contract := ContractRecord{
		ContractID:           "C-1",
		RoadID:               "NH-48-IN-DL-760",
		ContractorID:         "CONT-1",
		ContractorName:       "X",
		ContractValue:        0,
		CurrencyCode:         "INR",
		ContractStartEpoch:   1,
		ContractEndEpoch:     2,
		DefectLiabilityEpoch: 200,
	}
	startTx(stub, "tx2", 101)
	require.NoError(t, c.AssignContractor(ctx, mustJSON(t, contract)))
	endTx(stub, "tx2")

	startTx(stub, "tx3", 150)
	ok, err := c.IsUnderDefectLiability(ctx, "NH-48-IN-DL-760")
	endTx(stub, "tx3")
	require.NoError(t, err)
	require.True(t, ok)
}

func TestIsUnderDefectLiability_PeriodExpired_ReturnsFalse(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 100)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-759"))))
	endTx(stub, "tx1")

	contract := ContractRecord{
		ContractID:           "C-1",
		RoadID:               "NH-48-IN-DL-759",
		ContractorID:         "CONT-1",
		ContractorName:       "X",
		ContractValue:        0,
		CurrencyCode:         "INR",
		ContractStartEpoch:   1,
		ContractEndEpoch:     2,
		DefectLiabilityEpoch: 120,
	}
	startTx(stub, "tx2", 101)
	require.NoError(t, c.AssignContractor(ctx, mustJSON(t, contract)))
	endTx(stub, "tx2")

	startTx(stub, "tx3", 121)
	ok, err := c.IsUnderDefectLiability(ctx, "NH-48-IN-DL-759")
	endTx(stub, "tx3")
	require.NoError(t, err)
	require.False(t, ok)
}

func TestIsUnderDefectLiability_NoContract_ReturnsFalse(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 100)
	require.NoError(t, c.CreateRoad(ctx, mustJSON(t, createBaseRoad("NH-48-IN-DL-758"))))
	endTx(stub, "tx1")

	startTx(stub, "tx2", 101)
	ok, err := c.IsUnderDefectLiability(ctx, "NH-48-IN-DL-758")
	endTx(stub, "tx2")
	require.NoError(t, err)
	require.False(t, ok)
}

func TestInitLedger_SeedsThreeRoads(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.InitLedger(ctx))
	endTx(stub, "tx1")

	startTx(stub, "tx2", 1700000002)
	_, err := c.GetRoad(ctx, "NH-48-IN-DL-001")
	require.NoError(t, err)
	_, err = c.GetRoad(ctx, "SH-13-IN-MH-001")
	require.NoError(t, err)
	_, err = c.GetRoad(ctx, "MDR-44-IN-KA-001")
	require.NoError(t, err)
	endTx(stub, "tx2")
}

func TestInitLedger_SecondCall_Idempotent(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(RoadRegistryContract)

	startTx(stub, "tx1", 1700000001)
	require.NoError(t, c.InitLedger(ctx))
	endTx(stub, "tx1")

	countAfterFirst := len(stub.State)

	startTx(stub, "tx2", 1700000002)
	require.NoError(t, c.InitLedger(ctx))
	endTx(stub, "tx2")

	require.Equal(t, countAfterFirst, len(stub.State))
}
