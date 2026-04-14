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
	"strconv"
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
	cc := new(AuthorityRegistryContract)
	stub := shimtest.NewMockStub("authority-registry", cc)
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

func (s *richHistoryStub) evalQuery(query string) ([]*queryresult.KV, error) {
	var q map[string]any
	if err := json.Unmarshal([]byte(query), &q); err != nil {
		return nil, fmt.Errorf("invalid query JSON: %w", err)
	}

	selector, _ := q["selector"].(map[string]any)
	sortSpec := q["sort"]
	field1, asc1, field2, asc2 := parseTwoSort(sortSpec)

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
		d := docKV{key: k, value: v}
		if field1 != "" {
			d.sortVal1 = doc[field1]
		}
		if field2 != "" {
			d.sortVal2 = doc[field2]
		}
		docs = append(docs, d)
	}

	if field1 != "" {
		sort.Slice(docs, func(i, j int) bool {
			less := compareSortValues(docs[i].sortVal1, docs[j].sortVal1)
			if compareEqual(docs[i].sortVal1, docs[j].sortVal1) && field2 != "" {
				less = compareSortValues(docs[i].sortVal2, docs[j].sortVal2)
				if !asc2 {
					less = !less
				}
				return less
			}
			if asc1 {
				return less
			}
			return !less
		})
	} else {
		sort.Slice(docs, func(i, j int) bool { return docs[i].key < docs[j].key })
	}

	out := make([]*queryresult.KV, 0, len(docs))
	for _, d := range docs {
		out = append(out, &queryresult.KV{Key: d.key, Value: d.value})
	}
	return out, nil
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

func selectorMatch(doc map[string]any, selector map[string]any) (bool, error) {
	for k, v := range selector {
		docVal, ok := doc[k]
		if !ok {
			return false, nil
		}

		if m, ok := v.(map[string]any); ok {
			if elem, ok := m["$elemMatch"].(map[string]any); ok {
				eq, hasEq := elem["$eq"]
				if !hasEq {
					return false, nil
				}
				arr, ok := docVal.([]any)
				if !ok {
					return false, nil
				}
				found := false
				for _, item := range arr {
					if reflect.DeepEqual(coerceJSON(item), coerceJSON(eq)) {
						found = true
						break
					}
				}
				if !found {
					return false, nil
				}
				continue
			}
			if rng, ok := m["$gte"]; ok {
				n, ok := coerceJSON(docVal).(float64)
				if !ok {
					return false, nil
				}
				gte, ok := rng.(float64)
				if !ok {
					return false, nil
				}
				if n < gte {
					return false, nil
				}
				if lteRaw, ok := m["$lte"]; ok {
					lte, ok := lteRaw.(float64)
					if !ok {
						return false, nil
					}
					if n > lte {
						return false, nil
					}
				}
				continue
			}
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
		}

		if !reflect.DeepEqual(coerceJSON(docVal), coerceJSON(v)) {
			return false, nil
		}
	}
	return true, nil
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

func seedInitLedger(t *testing.T, stub *richHistoryStub, ctx contractapi.TransactionContextInterface, c *AuthorityRegistryContract) {
	startTx(stub, "init", 1700000001)
	require.NoError(t, c.InitLedger(ctx))
	endTx(stub, "init")
}

func registerEE(t *testing.T, stub *richHistoryStub, ctx contractapi.TransactionContextInterface, c *AuthorityRegistryContract, id string) AuthorityRecord {
	a := AuthorityRecord{
		AuthorityID: id,
		Name:        "Er. Test",
		Role:        "EE",
		Department:  "NHAI",
		RegionCodes: []string{"IN-DL"},
		RoadTypes:   []string{"NH"},
		IsActive:    true,
	}
	startTx(stub, "tx-reg-"+id, 1700000002)
	require.NoError(t, c.RegisterAuthority(ctx, mustJSON(t, a)))
	endTx(stub, "tx-reg-"+id)
	requireEvent(t, stub.MockStub, "AuthorityRegistered")
	return a
}

func TestRegisterAuthority_ValidEE_Success(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	a := AuthorityRecord{AuthorityID: "EE-NHAI-1", Name: "Er. A", Role: "EE", Department: "NHAI", RegionCodes: []string{"IN-DL"}, RoadTypes: []string{"NH"}}
	startTx(stub, "tx1", 1700000002)
	err := c.RegisterAuthority(ctx, mustJSON(t, a))
	endTx(stub, "tx1")
	require.NoError(t, err)
	requireEvent(t, stub.MockStub, "AuthorityRegistered")

	got, err := c.GetAuthority(ctx, "EE-NHAI-1")
	require.NoError(t, err)
	require.True(t, got.IsActive)
	require.Equal(t, 1, got.Version)
}

func TestRegisterAuthority_InvalidRole_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	a := AuthorityRecord{AuthorityID: "A1", Name: "X", Role: "BAD", Department: "NHAI", RegionCodes: []string{"IN-DL"}, RoadTypes: []string{"NH"}}
	startTx(stub, "tx1", 1700000002)
	err := c.RegisterAuthority(ctx, mustJSON(t, a))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRegisterAuthority_InvalidDepartment_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	a := AuthorityRecord{AuthorityID: "A2", Name: "X", Role: "EE", Department: "BAD", RegionCodes: []string{"IN-DL"}, RoadTypes: []string{"NH"}}
	startTx(stub, "tx1", 1700000002)
	err := c.RegisterAuthority(ctx, mustJSON(t, a))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRegisterAuthority_EmptyRegionCodes_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	a := AuthorityRecord{AuthorityID: "A3", Name: "X", Role: "EE", Department: "NHAI", RegionCodes: []string{}, RoadTypes: []string{"NH"}}
	startTx(stub, "tx1", 1700000002)
	err := c.RegisterAuthority(ctx, mustJSON(t, a))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRegisterAuthority_TooManyRegionCodes_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	var regions []string
	for i := 0; i < MaxRegionCodes+1; i++ {
		regions = append(regions, fmt.Sprintf("IN-%02d", i))
	}
	a := AuthorityRecord{AuthorityID: "A4", Name: "X", Role: "EE", Department: "NHAI", RegionCodes: regions, RoadTypes: []string{"NH"}}
	startTx(stub, "tx1", 1700000002)
	err := c.RegisterAuthority(ctx, mustJSON(t, a))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRegisterAuthority_InvalidContactHashLength_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	a := AuthorityRecord{AuthorityID: "A5", Name: "X", Role: "EE", Department: "NHAI", RegionCodes: []string{"IN-DL"}, RoadTypes: []string{"NH"}, ContactHash: "abcd"}
	startTx(stub, "tx1", 1700000002)
	err := c.RegisterAuthority(ctx, mustJSON(t, a))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRegisterAuthority_DuplicateAuthorityID_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	a := AuthorityRecord{AuthorityID: "A6", Name: "X", Role: "EE", Department: "NHAI", RegionCodes: []string{"IN-DL"}, RoadTypes: []string{"NH"}}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RegisterAuthority(ctx, mustJSON(t, a)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "AuthorityRegistered")

	startTx(stub, "tx2", 1700000003)
	err := c.RegisterAuthority(ctx, mustJSON(t, a))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestRegisterAuthority_WrongMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	a := AuthorityRecord{AuthorityID: "A7", Name: "X", Role: "EE", Department: "NHAI", RegionCodes: []string{"IN-DL"}, RoadTypes: []string{"NH"}}
	startTx(stub, "tx1", 1700000002)
	err := c.RegisterAuthority(ctx, mustJSON(t, a))
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestRegisterAuthority_EmitsEvent_AuthorityRegistered(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	a := AuthorityRecord{AuthorityID: "A8", Name: "X", Role: "EE", Department: "NHAI", RegionCodes: []string{"IN-DL"}, RoadTypes: []string{"NH"}}
	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RegisterAuthority(ctx, mustJSON(t, a)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "AuthorityRegistered")
}

func TestUpdateAuthority_ValidUpdate_IncrementsVersion(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "UA1")
	got, _ := c.GetAuthority(ctx, "UA1")

	upd := *got
	upd.Name = "Er. Updated"
	upd.Version = got.Version

	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.UpdateAuthority(ctx, "UA1", mustJSON(t, upd)))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityUpdated")

	got2, err := c.GetAuthority(ctx, "UA1")
	require.NoError(t, err)
	require.Equal(t, 2, got2.Version)
	require.Equal(t, "Er. Updated", got2.Name)
}

func TestUpdateAuthority_VersionConflict_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "UA2")

	upd := AuthorityRecord{AuthorityID: "UA2", Name: "X", Role: "EE", Department: "NHAI", RegionCodes: []string{"IN-DL"}, RoadTypes: []string{"NH"}, Version: 999, IsActive: true}
	startTx(stub, "tx2", 1700000003)
	err := c.UpdateAuthority(ctx, "UA2", mustJSON(t, upd))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestUpdateAuthority_CannotChangeAuthorityID(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "UA3")
	got, _ := c.GetAuthority(ctx, "UA3")
	upd := *got
	upd.AuthorityID = "DIFF"
	upd.Version = got.Version

	startTx(stub, "tx2", 1700000003)
	err := c.UpdateAuthority(ctx, "UA3", mustJSON(t, upd))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestUpdateAuthority_WrongMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "UA4")
	got, _ := c.GetAuthority(ctx, "UA4")
	upd := *got
	upd.Name = "X"
	upd.Version = got.Version

	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")
	startTx(stub, "tx2", 1700000003)
	err := c.UpdateAuthority(ctx, "UA4", mustJSON(t, upd))
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestDeactivateAuthority_Active_SetsInactive(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "DA1")
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.DeactivateAuthority(ctx, "DA1"))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityDeactivated")

	got, err := c.GetAuthority(ctx, "DA1")
	require.NoError(t, err)
	require.False(t, got.IsActive)
}

func TestDeactivateAuthority_AlreadyInactive_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "DA2")
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.DeactivateAuthority(ctx, "DA2"))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityDeactivated")

	startTx(stub, "tx3", 1700000004)
	err := c.DeactivateAuthority(ctx, "DA2")
	endTx(stub, "tx3")
	require.Error(t, err)
}

func TestDeactivateAuthority_NotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	startTx(stub, "tx1", 1700000002)
	err := c.DeactivateAuthority(ctx, "NOPE")
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestDeactivateAuthority_PreservesRecord(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "DA3")
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.DeactivateAuthority(ctx, "DA3"))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityDeactivated")

	k, _ := stub.CreateCompositeKey(KeyPrefixAuthority, []string{"DA3"})
	b, err := stub.GetState(k)
	require.NoError(t, err)
	require.NotNil(t, b)
}

func TestDeactivateAuthority_WrongMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	startTx(stub, "tx1", 1700000002)
	err := c.DeactivateAuthority(ctx, "DA4")
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestLogAction_ValidAcknowledged_Success(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "LA1")

	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.LogAction(ctx, "CMP-1", "LA1", "ACKNOWLEDGED", ""))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")
}

func TestLogAction_ValidResolved_Success(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "LA2")

	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.LogAction(ctx, "CMP-2", "LA2", "RESOLVED", "done"))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")
}

func TestLogAction_AllActionTypesValid(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "LA3")
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	for i, at := range AllowedActionTypes {
		startTx(stub, fmt.Sprintf("tx%d", i+10), 1700000100+int64(i))
		require.NoError(t, c.LogAction(ctx, fmt.Sprintf("CMP-%d", i), "LA3", at, ""))
		endTx(stub, fmt.Sprintf("tx%d", i+10))
		requireEvent(t, stub.MockStub, "AuthorityActionLogged")
	}
}

func TestLogAction_InvalidActionType_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "LA4")
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	startTx(stub, "tx2", 1700000003)
	err := c.LogAction(ctx, "CMP", "LA4", "BAD", "")
	endTx(stub, "tx2")
	require.Error(t, err)
}

func TestLogAction_AuthorityNotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	startTx(stub, "tx1", 1700000002)
	err := c.LogAction(ctx, "CMP", "NOPE", "ACKNOWLEDGED", "")
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestLogAction_InactiveAuthority_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "LA5")
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.DeactivateAuthority(ctx, "LA5"))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityDeactivated")

	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")
	startTx(stub, "tx3", 1700000004)
	err := c.LogAction(ctx, "CMP", "LA5", "ACKNOWLEDGED", "")
	endTx(stub, "tx3")
	require.Error(t, err)
}

func TestLogAction_NotesTooLong_TruncatesTo500(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "LA6")
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	long := strings.Repeat("a", MaxNotesLength+10)
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.LogAction(ctx, "CMP", "LA6", "NOTE_ADDED", long))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	// Ensure stored record has truncated notes.
	k, _ := stub.CreateCompositeKey(KeyPrefixAction, []string{"LA6", strconv.FormatInt(1700000003, 10), "CMP"})
	b, err := stub.GetState(k)
	require.NoError(t, err)
	var l ActionLog
	require.NoError(t, json.Unmarshal(b, &l))
	require.Len(t, l.Notes, MaxNotesLength)
}

func TestLogAction_AppendOnly_TwoActionsOnSameComplaint(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "LA7")
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.LogAction(ctx, "CMP-X", "LA7", "ACKNOWLEDGED", ""))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	startTx(stub, "tx3", 1700000004)
	require.NoError(t, c.LogAction(ctx, "CMP-X", "LA7", "NOTE_ADDED", "n"))
	endTx(stub, "tx3")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	page, err := c.GetAuthorityActionHistory(ctx, "LA7", 10, "")
	require.NoError(t, err)
	require.Len(t, page.Actions, 2)
}

func TestLogAction_BothMSPsAllowed(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "LA8")

	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.LogAction(ctx, "CMP-1", "LA8", "ACKNOWLEDGED", ""))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	stub.Creator = mockCreator(t, "NHAIMSP", "Test Admin")
	startTx(stub, "tx3", 1700000004)
	require.NoError(t, c.LogAction(ctx, "CMP-1", "LA8", "NOTE_ADDED", ""))
	endTx(stub, "tx3")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")
}

func TestLogAction_EmitsEvent_AuthorityActionLogged(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "LA9")
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.LogAction(ctx, "CMP-9", "LA9", "ACKNOWLEDGED", ""))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")
}

func TestGetAuthority_Exists_ReturnsRecord(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "GA1")
	got, err := c.GetAuthority(ctx, "GA1")
	require.NoError(t, err)
	require.Equal(t, "GA1", got.AuthorityID)
}

func TestGetAuthority_NotFound_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	_, err := c.GetAuthority(ctx, "NOPE")
	require.Error(t, err)
}

func TestGetAuthorityActionHistory_MultipleActions_ReturnsPaginated(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "H1")
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	for i := 0; i < 5; i++ {
		startTx(stub, fmt.Sprintf("tx%d", i+10), 1700000100+int64(i))
		require.NoError(t, c.LogAction(ctx, fmt.Sprintf("CMP-%d", i), "H1", "ACKNOWLEDGED", ""))
		endTx(stub, fmt.Sprintf("tx%d", i+10))
		requireEvent(t, stub.MockStub, "AuthorityActionLogged")
	}

	page1, err := c.GetAuthorityActionHistory(ctx, "H1", 2, "")
	require.NoError(t, err)
	require.Len(t, page1.Actions, 2)
	require.NotEmpty(t, page1.Bookmark)

	page2, err := c.GetAuthorityActionHistory(ctx, "H1", 2, page1.Bookmark)
	require.NoError(t, err)
	require.Len(t, page2.Actions, 2)
}

func TestGetAuthorityActionHistory_WrongMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "OtherMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	_, err := c.GetAuthorityActionHistory(ctx, "X", 10, "")
	require.Error(t, err)
}

func TestGetAuthorityActionHistory_PageSizeEnforced(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "H2")
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	for i := 0; i < 150; i++ {
		startTx(stub, fmt.Sprintf("tx%d", i+10), 1700000200+int64(i))
		require.NoError(t, c.LogAction(ctx, fmt.Sprintf("CMP-%d", i), "H2", "ACKNOWLEDGED", ""))
		endTx(stub, fmt.Sprintf("tx%d", i+10))
		requireEvent(t, stub.MockStub, "AuthorityActionLogged")
	}

	page, err := c.GetAuthorityActionHistory(ctx, "H2", 1000, "")
	require.NoError(t, err)
	require.LessOrEqual(t, len(page.Actions), int(maxPageSize))
}

func TestGetComplaintActionHistory_MultipleActions_ReturnsSortedAsc(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "C1")
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	startTx(stub, "tx2", 30)
	require.NoError(t, c.LogAction(ctx, "CMP-Z", "C1", "NOTE_ADDED", ""))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	startTx(stub, "tx1", 10)
	require.NoError(t, c.LogAction(ctx, "CMP-Z", "C1", "ACKNOWLEDGED", ""))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	actions, err := c.GetComplaintActionHistory(ctx, "CMP-Z")
	require.NoError(t, err)
	require.Len(t, actions, 2)
	require.True(t, actions[0].Timestamp <= actions[1].Timestamp)
}

func TestGetComplaintActionHistory_NoActions_ReturnsEmptySlice(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	actions, err := c.GetComplaintActionHistory(ctx, "CMP-EMPTY")
	require.NoError(t, err)
	require.Empty(t, actions)
}

func TestGetComplaintActionHistory_AnyMemberCanRead(t *testing.T) {
	stub := newTestStub(t, "OtherMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	actions, err := c.GetComplaintActionHistory(ctx, "CMP-X")
	require.NoError(t, err)
	require.Empty(t, actions)
}

func TestGetAuthoritiesByRegion_ActiveOnly_ReturnsActiveOnly(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	a1 := AuthorityRecord{AuthorityID: "AR1", Name: "X", Role: "EE", Department: "NHAI", RegionCodes: []string{"IN-DL"}, RoadTypes: []string{"NH"}, IsActive: true}
	a2 := AuthorityRecord{AuthorityID: "AR2", Name: "Y", Role: "Inspector", Department: "PWD", RegionCodes: []string{"IN-DL"}, RoadTypes: []string{"Urban"}, IsActive: true}

	startTx(stub, "tx1", 1700000002)
	require.NoError(t, c.RegisterAuthority(ctx, mustJSON(t, a1)))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "AuthorityRegistered")
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.RegisterAuthority(ctx, mustJSON(t, a2)))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityRegistered")

	// Deactivate one
	startTx(stub, "tx3", 1700000004)
	require.NoError(t, c.DeactivateAuthority(ctx, "AR2"))
	endTx(stub, "tx3")
	requireEvent(t, stub.MockStub, "AuthorityDeactivated")

	res, err := c.GetAuthoritiesByRegion(ctx, "IN-DL")
	require.NoError(t, err)
	require.Len(t, res, 1)
	require.Equal(t, "AR1", res[0].AuthorityID)
}

func TestGetAuthoritiesByRegion_InactiveExcluded(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "AR3")
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.DeactivateAuthority(ctx, "AR3"))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityDeactivated")

	res, err := c.GetAuthoritiesByRegion(ctx, "IN-DL")
	require.NoError(t, err)
	for _, a := range res {
		require.True(t, a.IsActive)
	}
}

func TestGetInactiveAuthorities_ReturnsOnlyInactive(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "IAR1")
	startTx(stub, "tx2", 1700000003)
	require.NoError(t, c.DeactivateAuthority(ctx, "IAR1"))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityDeactivated")

	res, err := c.GetInactiveAuthorities(ctx, "IN-DL")
	require.NoError(t, err)
	require.Len(t, res, 1)
	require.False(t, res[0].IsActive)
}

func TestGetInactiveAuthorities_WrongMSP_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "RoadWatchMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	_, err := c.GetInactiveAuthorities(ctx, "IN-DL")
	require.Error(t, err)
}

func TestCalculatePerformanceScore_AllResolved_Returns100(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "PS1")
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	startTx(stub, "tx1", 100)
	require.NoError(t, c.LogAction(ctx, "CMP-1", "PS1", "ACKNOWLEDGED", ""))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	startTx(stub, "tx2", 110)
	require.NoError(t, c.LogAction(ctx, "CMP-1", "PS1", "RESOLVED", ""))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	startTx(stub, "tx3", 120)
	score, err := c.CalculatePerformanceScore(ctx, "PS1", 90, 130)
	endTx(stub, "tx3")
	require.NoError(t, err)
	require.InDelta(t, 100.0, score.Score, 0.0001)
}

func TestCalculatePerformanceScore_NoneResolved_Returns0(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "PS2")
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	startTx(stub, "tx1", 100)
	require.NoError(t, c.LogAction(ctx, "CMP-1", "PS2", "ACKNOWLEDGED", ""))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	startTx(stub, "tx2", 110)
	score, err := c.CalculatePerformanceScore(ctx, "PS2", 90, 120)
	endTx(stub, "tx2")
	require.NoError(t, err)
	require.InDelta(t, 0.0, score.Score, 0.0001)
}

func TestCalculatePerformanceScore_PartialResolution_CorrectPct(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "PS3")
	stub.Creator = mockCreator(t, "RoadWatchMSP", "Test Admin")

	startTx(stub, "tx1", 100)
	require.NoError(t, c.LogAction(ctx, "CMP-1", "PS3", "ACKNOWLEDGED", ""))
	endTx(stub, "tx1")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	startTx(stub, "tx2", 105)
	require.NoError(t, c.LogAction(ctx, "CMP-2", "PS3", "ACKNOWLEDGED", ""))
	endTx(stub, "tx2")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	startTx(stub, "tx3", 110)
	require.NoError(t, c.LogAction(ctx, "CMP-1", "PS3", "RESOLVED", ""))
	endTx(stub, "tx3")
	requireEvent(t, stub.MockStub, "AuthorityActionLogged")

	startTx(stub, "tx4", 120)
	score, err := c.CalculatePerformanceScore(ctx, "PS3", 90, 130)
	endTx(stub, "tx4")
	require.NoError(t, err)
	require.InDelta(t, 50.0, score.Score, 0.0001)
}

func TestCalculatePerformanceScore_NoActions_Returns0NotError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "PS4")
	startTx(stub, "tx2", 110)
	score, err := c.CalculatePerformanceScore(ctx, "PS4", 90, 120)
	endTx(stub, "tx2")
	require.NoError(t, err)
	require.InDelta(t, 0.0, score.Score, 0.0001)
}

func TestCalculatePerformanceScore_InvalidTimeRange_ReturnsError(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	startTx(stub, "tx1", 100)
	_, err := c.CalculatePerformanceScore(ctx, "X", 10, 10)
	endTx(stub, "tx1")
	require.Error(t, err)
}

func TestCalculatePerformanceScore_ReadOnly_DoesNotModifyState(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	registerEE(t, stub, ctx, c, "PS5")

	before := make(map[string][]byte, len(stub.State))
	for k, v := range stub.State {
		vv := make([]byte, len(v))
		copy(vv, v)
		before[k] = vv
	}

	startTx(stub, "tx2", 110)
	_, err := c.CalculatePerformanceScore(ctx, "PS5", 90, 120)
	endTx(stub, "tx2")
	require.NoError(t, err)

	require.Equal(t, len(before), len(stub.State))
	for k, v := range before {
		require.Equal(t, v, stub.State[k])
	}
}

func TestInitLedger_SeedsThreeAuthorities(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	seedInitLedger(t, stub, ctx, c)
	drainEvents(stub.MockStub)

	_, err := c.GetAuthority(ctx, "EE-NHAI-ZONE3-001")
	require.NoError(t, err)
	_, err = c.GetAuthority(ctx, "SE-NHAI-NORTH-001")
	require.NoError(t, err)
	_, err = c.GetAuthority(ctx, "INS-PWD-DL-001")
	require.NoError(t, err)
}

func TestInitLedger_SecondCall_Idempotent(t *testing.T) {
	stub := newTestStub(t, "NHAIMSP")
	ctx := newTestContext(stub)
	c := new(AuthorityRegistryContract)

	seedInitLedger(t, stub, ctx, c)
	seedInitLedger(t, stub, ctx, c)
	drainEvents(stub.MockStub)

	iter, err := stub.GetStateByPartialCompositeKey(KeyPrefixAuthority, []string{})
	require.NoError(t, err)
	defer iter.Close()

	count := 0
	for iter.HasNext() {
		_, err := iter.Next()
		require.NoError(t, err)
		count++
	}
	require.GreaterOrEqual(t, count, 3)
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
