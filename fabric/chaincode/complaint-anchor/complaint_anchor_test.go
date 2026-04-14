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
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/hyperledger/fabric-chaincode-go/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-chaincode-go/shimtest"
	"github.com/hyperledger/fabric-protos-go/ledger/queryresult"
	msp "github.com/hyperledger/fabric-protos-go/msp"
	peer "github.com/hyperledger/fabric-protos-go/peer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testTxContext struct {
	stub   shim.ChaincodeStubInterface
	client cid.ClientIdentity
}

func (t *testTxContext) GetStub() shim.ChaincodeStubInterface  { return t.stub }
func (t *testTxContext) GetClientIdentity() cid.ClientIdentity { return t.client }

func newTestContext(stub shim.ChaincodeStubInterface) (*testTxContext, error) {
	ci, err := cid.New(stub)
	if err != nil {
		return nil, err
	}
	return &testTxContext{stub: stub, client: ci}, nil
}

type mockQueryIterator struct {
	results []*queryresult.KV
	idx     int
}

func (m *mockQueryIterator) HasNext() bool { return m.idx < len(m.results) }
func (m *mockQueryIterator) Next() (*queryresult.KV, error) {
	if !m.HasNext() {
		return nil, fmt.Errorf("no more results")
	}
	kv := m.results[m.idx]
	m.idx++
	return kv, nil
}
func (m *mockQueryIterator) Close() error { return nil }

type richQueryStub struct{ *shimtest.MockStub }

type mangoQuery struct {
	Selector map[string]any      `json:"selector"`
	Sort     []map[string]string `json:"sort"`
}

func (s *richQueryStub) GetQueryResult(query string) (shim.StateQueryIteratorInterface, error) {
	kvs, err := s.evalMango(query)
	if err != nil {
		return nil, err
	}
	return &mockQueryIterator{results: kvs}, nil
}

func (s *richQueryStub) GetQueryResultWithPagination(query string, pageSize int32, bookmark string) (shim.StateQueryIteratorInterface, *peer.QueryResponseMetadata, error) {
	kvs, err := s.evalMango(query)
	if err != nil {
		return nil, nil, err
	}

	start := 0
	if bookmark != "" {
		for i, kv := range kvs {
			if kv.Key == bookmark {
				start = i + 1
				break
			}
		}
	}
	if start > len(kvs) {
		start = len(kvs)
	}

	end := start + int(pageSize)
	if end > len(kvs) {
		end = len(kvs)
	}
	page := kvs[start:end]

	next := ""
	if end < len(kvs) && len(page) > 0 {
		next = page[len(page)-1].Key
	}

	meta := &peer.QueryResponseMetadata{FetchedRecordsCount: int32(len(page)), Bookmark: next}
	return &mockQueryIterator{results: page}, meta, nil
}

func (s *richQueryStub) evalMango(query string) ([]*queryresult.KV, error) {
	var q mangoQuery
	if err := json.Unmarshal([]byte(query), &q); err != nil {
		return nil, fmt.Errorf("bad query json: %w", err)
	}
	if q.Selector == nil {
		q.Selector = map[string]any{}
	}

	type docKV struct {
		key string
		kv  *queryresult.KV
		doc map[string]any
	}

	matches := make([]docKV, 0)
	for k, v := range s.State {
		doc := map[string]any{}
		if err := json.Unmarshal(v, &doc); err != nil {
			continue
		}
		if !matchesSelector(doc, q.Selector) {
			continue
		}
		matches = append(matches, docKV{key: k, kv: &queryresult.KV{Key: k, Value: v}, doc: doc})
	}

	if len(q.Sort) > 0 {
		if dir, ok := q.Sort[0]["timestamp"]; ok {
			sort.Slice(matches, func(i, j int) bool {
				ti := asInt64(matches[i].doc["timestamp"])
				tj := asInt64(matches[j].doc["timestamp"])
				if dir == "desc" {
					return ti > tj
				}
				return ti < tj
			})
		} else {
			sort.Slice(matches, func(i, j int) bool { return matches[i].key < matches[j].key })
		}
	} else {
		sort.Slice(matches, func(i, j int) bool { return matches[i].key < matches[j].key })
	}

	out := make([]*queryresult.KV, 0, len(matches))
	for _, m := range matches {
		out = append(out, m.kv)
	}
	return out, nil
}

func matchesSelector(doc map[string]any, selector map[string]any) bool {
	for field, want := range selector {
		have, exists := doc[field]

		switch w := want.(type) {
		case map[string]any:
			if gte, ok := w["$gte"]; ok {
				if !exists || asInt64(have) < asInt64(gte) {
					return false
				}
			}
			if lte, ok := w["$lte"]; ok {
				if !exists || asInt64(have) > asInt64(lte) {
					return false
				}
			}
		default:
			if !exists {
				return false
			}
			if fmt.Sprintf("%v", have) != fmt.Sprintf("%v", w) {
				return false
			}
		}
	}
	return true
}

func asInt64(v any) int64 {
	switch t := v.(type) {
	case int64:
		return t
	case int:
		return int64(t)
	case float64:
		return int64(t)
	case float32:
		return int64(t)
	default:
		return 0
	}
}

func newTestStub(t *testing.T, mspID string) *shimtest.MockStub {
	t.Helper()
	stub := shimtest.NewMockStub("complaint-anchor", new(ComplaintAnchorContract))
	stub.Creator = mockCreator(mspID)
	return stub
}

var (
	testCertOnce sync.Once
	testCertPEM  []byte
)

func mockCreator(mspID string) []byte {
	testCertOnce.Do(func() {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			panic(err)
		}

		serial, err := rand.Int(rand.Reader, big.NewInt(1<<62))
		if err != nil {
			panic(err)
		}

		tpl := x509.Certificate{
			SerialNumber: serial,
			Subject:      pkix.Name{CommonName: "Test Admin"},
			NotBefore:    time.Now().Add(-time.Hour),
			NotAfter:     time.Now().Add(time.Hour),
			KeyUsage:     x509.KeyUsageDigitalSignature,
		}

		der, err := x509.CreateCertificate(rand.Reader, &tpl, &tpl, &key.PublicKey, key)
		if err != nil {
			panic(err)
		}
		testCertPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	})

	sid := &msp.SerializedIdentity{Mspid: mspID, IdBytes: testCertPEM}
	out, err := proto.Marshal(sid)
	if err != nil {
		panic(err)
	}
	return out
}

func startTx(stub *shimtest.MockStub, txid string, seconds int64) {
	stub.MockTransactionStart(txid)
	stub.TxTimestamp = &timestamp.Timestamp{Seconds: seconds, Nanos: 0}
}

func endTx(stub *shimtest.MockStub, txid string) {
	stub.MockTransactionEnd(txid)
}

func drainEvent(stub *shimtest.MockStub) *peer.ChaincodeEvent {
	select {
	case ev := <-stub.ChaincodeEventsChannel:
		return ev
	default:
		return nil
	}
}

func TestSubmitMerkleRoot_ValidInput_Success(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 1000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	root := strings.Repeat("a", 64)
	err = contract.SubmitMerkleRoot(ctx, root, "IN-DL", 3)
	require.NoError(t, err)
	endTx(stub.MockStub, "tx1")

	key, err := stub.CreateCompositeKey(KeyPrefixAnchor, []string{root})
	require.NoError(t, err)
	state, err := stub.GetState(key)
	require.NoError(t, err)
	require.NotNil(t, state)
}

func TestSubmitMerkleRoot_DuplicateRoot_ReturnsNilIdempotent(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)
	root := strings.Repeat("b", 64)

	startTx(stub.MockStub, "tx1", 1000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.SubmitMerkleRoot(ctx, root, "IN-DL", 1))
	endTx(stub.MockStub, "tx1")
	require.NotNil(t, drainEvent(stub.MockStub))

	startTx(stub.MockStub, "tx2", 1001)
	ctx2, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.SubmitMerkleRoot(ctx2, root, "IN-DL", 1))
	endTx(stub.MockStub, "tx2")
	require.Nil(t, drainEvent(stub.MockStub))
}

func TestSubmitMerkleRoot_InvalidHex_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 1000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.SubmitMerkleRoot(ctx, strings.Repeat("z", 64), "IN-DL", 1)
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestSubmitMerkleRoot_BatchSizeZero_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 1000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.SubmitMerkleRoot(ctx, strings.Repeat("a", 64), "IN-DL", 0)
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestSubmitMerkleRoot_BatchSizeOver100_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 1000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.SubmitMerkleRoot(ctx, strings.Repeat("a", 64), "IN-DL", 101)
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestSubmitMerkleRoot_UnauthorizedMSP_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "OtherMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 1000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.SubmitMerkleRoot(ctx, strings.Repeat("a", 64), "IN-DL", 1)
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestSubmitMerkleRoot_EmptyMerkleRoot_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 1000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.SubmitMerkleRoot(ctx, "", "IN-DL", 1)
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestSubmitMerkleRoot_EmitsEvent_MerkleRootAnchored(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 1000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.SubmitMerkleRoot(ctx, strings.Repeat("c", 64), "IN-DL", 2)
	require.NoError(t, err)
	endTx(stub.MockStub, "tx1")

	ev := drainEvent(stub.MockStub)
	require.NotNil(t, ev)
	assert.Equal(t, "MerkleRootAnchored", ev.EventName)
}

func TestVerifyMerkleRoot_ExistingRoot_ReturnsAnchor(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)
	root := strings.Repeat("d", 64)

	startTx(stub.MockStub, "tx1", 1000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.SubmitMerkleRoot(ctx, root, "IN-DL", 1))
	endTx(stub.MockStub, "tx1")
	require.NotNil(t, drainEvent(stub.MockStub))

	startTx(stub.MockStub, "tx2", 1001)
	stub.Creator = mockCreator("OtherMSP")
	ctx2, err := newTestContext(stub)
	require.NoError(t, err)
	got, err := contract.VerifyMerkleRoot(ctx2, root)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, root, got.MerkleRoot)
	assert.Equal(t, "ANCHOR_"+root[:16], got.AnchorID)
	endTx(stub.MockStub, "tx2")
}

func TestVerifyMerkleRoot_NonExistentRoot_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 1000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	_, err = contract.VerifyMerkleRoot(ctx, strings.Repeat("e", 64))
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestVerifyMerkleRoot_InvalidFormat_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 1000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	_, err = contract.VerifyMerkleRoot(ctx, strings.Repeat("a", 63))
	require.Error(t, err)
	_, err = contract.VerifyMerkleRoot(ctx, strings.Repeat("A", 64))
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestAnchorEscalation_ValidTier1_Success(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 2000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.AnchorEscalation(ctx, "C-1", "AUTH-1", "AUTH-2", 1, 8)
	require.NoError(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestAnchorEscalation_ValidTier5_Success(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 2000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.AnchorEscalation(ctx, "C-5", "AUTH-1", "AUTH-2", 5, 0)
	require.NoError(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestAnchorEscalation_TierZero_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 2000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.AnchorEscalation(ctx, "C-0", "AUTH-1", "AUTH-2", 0, 0)
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestAnchorEscalation_TierSix_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 2000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.AnchorEscalation(ctx, "C-6", "AUTH-1", "AUTH-2", 6, 0)
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestAnchorEscalation_SameFromAndTo_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 2000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.AnchorEscalation(ctx, "C-SAME", "AUTH-1", "AUTH-1", 1, 1)
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestAnchorEscalation_WrongMSP_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "NHAIMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 2000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.AnchorEscalation(ctx, "C-WRONG", "AUTH-1", "AUTH-2", 1, 1)
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestAnchorEscalation_AppendOnly_TwoEscalationsOnSameComplaint(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 3000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.AnchorEscalation(ctx, "C-APP", "AUTH-1", "AUTH-2", 1, 0))
	endTx(stub.MockStub, "tx1")
	require.NotNil(t, drainEvent(stub.MockStub))

	startTx(stub.MockStub, "tx2", 3001)
	ctx2, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.AnchorEscalation(ctx2, "C-APP", "AUTH-1", "AUTH-2", 2, 1))
	endTx(stub.MockStub, "tx2")
	require.NotNil(t, drainEvent(stub.MockStub))

	startTx(stub.MockStub, "tx3", 3002)
	ctx3, err := newTestContext(stub)
	require.NoError(t, err)
	hist, err := contract.GetEscalationHistory(ctx3, "C-APP")
	require.NoError(t, err)
	require.Len(t, hist, 2)
	endTx(stub.MockStub, "tx3")
}

func TestAnchorResolution_ValidQmCID_Success(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "NHAIMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 4000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	repairCID := "Qm" + strings.Repeat("a", 44)
	err = contract.AnchorResolution(ctx, "C-RES-1", "AUTH-PERSON", repairCID, strings.Repeat("1", 64))
	require.NoError(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestAnchorResolution_ValidBafyCID_Success(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 4000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	repairCID := "bafy" + strings.Repeat("a", 20)
	err = contract.AnchorResolution(ctx, "C-RES-2", "AUTH-PERSON", repairCID, strings.Repeat("2", 64))
	require.NoError(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestAnchorResolution_InvalidCID_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "NHAIMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 4000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.AnchorResolution(ctx, "C-RES-3", "AUTH-PERSON", "notcid", strings.Repeat("3", 64))
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestAnchorResolution_InvalidCaptureHash_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "NHAIMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 4000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	err = contract.AnchorResolution(ctx, "C-RES-4", "AUTH-PERSON", "Qm"+strings.Repeat("a", 44), "xyz")
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestAnchorResolution_DuplicateResolution_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "NHAIMSP")}
	contract := new(ComplaintAnchorContract)
	repairCID := "Qm" + strings.Repeat("a", 44)
	hash := strings.Repeat("4", 64)

	startTx(stub.MockStub, "tx1", 4000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.AnchorResolution(ctx, "C-RES-DUP", "AUTH-PERSON", repairCID, hash))
	endTx(stub.MockStub, "tx1")
	require.NotNil(t, drainEvent(stub.MockStub))

	startTx(stub.MockStub, "tx2", 4001)
	ctx2, err := newTestContext(stub)
	require.NoError(t, err)
	err = contract.AnchorResolution(ctx2, "C-RES-DUP", "AUTH-PERSON", repairCID, hash)
	require.Error(t, err)
	endTx(stub.MockStub, "tx2")
}

func TestAnchorResolution_EmitsEvent_ComplaintResolved(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 4000)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)

	repairCID := "Qm" + strings.Repeat("a", 44)
	err = contract.AnchorResolution(ctx, "C-RES-EV", "AUTH-PERSON", repairCID, strings.Repeat("5", 64))
	require.NoError(t, err)
	endTx(stub.MockStub, "tx1")

	ev := drainEvent(stub.MockStub)
	require.NotNil(t, ev)
	assert.Equal(t, "ComplaintResolved", ev.EventName)
}

func TestGetEscalationHistory_MultipleEscalations_ReturnsSortedByTimestamp(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 100)
	ctx1, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.AnchorEscalation(ctx1, "C-HIST", "AUTH-1", "AUTH-2", 1, 1))
	endTx(stub.MockStub, "tx1")
	require.NotNil(t, drainEvent(stub.MockStub))

	startTx(stub.MockStub, "tx2", 200)
	ctx2, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.AnchorEscalation(ctx2, "C-HIST", "AUTH-2", "AUTH-3", 2, 2))
	endTx(stub.MockStub, "tx2")
	require.NotNil(t, drainEvent(stub.MockStub))

	startTx(stub.MockStub, "tx3", 300)
	ctx3, err := newTestContext(stub)
	require.NoError(t, err)
	hist, err := contract.GetEscalationHistory(ctx3, "C-HIST")
	require.NoError(t, err)
	require.Len(t, hist, 2)
	assert.LessOrEqual(t, hist[0].Timestamp, hist[1].Timestamp)
	endTx(stub.MockStub, "tx3")
}

func TestGetEscalationHistory_NoEscalations_ReturnsEmptySlice(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 300)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)
	hist, err := contract.GetEscalationHistory(ctx, "C-NONE")
	require.NoError(t, err)
	require.NotNil(t, hist)
	assert.Len(t, hist, 0)
	endTx(stub.MockStub, "tx1")
}

func TestGetResolutionProof_Exists_ReturnsProof(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "NHAIMSP")}
	contract := new(ComplaintAnchorContract)
	cidStr := "Qm" + strings.Repeat("a", 44)
	hash := strings.Repeat("6", 64)

	startTx(stub.MockStub, "tx1", 500)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.AnchorResolution(ctx, "C-PROOF", "AUTH-PERSON", cidStr, hash))
	endTx(stub.MockStub, "tx1")
	require.NotNil(t, drainEvent(stub.MockStub))

	startTx(stub.MockStub, "tx2", 501)
	ctx2, err := newTestContext(stub)
	require.NoError(t, err)
	proof, err := contract.GetResolutionProof(ctx2, "C-PROOF")
	require.NoError(t, err)
	require.NotNil(t, proof)
	assert.Equal(t, "C-PROOF", proof.ComplaintID)
	endTx(stub.MockStub, "tx2")
}

func TestGetResolutionProof_NotFound_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 500)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)
	_, err = contract.GetResolutionProof(ctx, "C-NO")
	require.Error(t, err)
	endTx(stub.MockStub, "tx1")
}

func TestGetAnchorsByRegion_WithinTimeRange_ReturnsResults(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	roots := []string{strings.Repeat("0", 64), strings.Repeat("1", 64), strings.Repeat("2", 64)}
	times := []int64{1000, 1100, 1200}
	for i := 0; i < 3; i++ {
		startTx(stub.MockStub, fmt.Sprintf("tx%d", i+1), times[i])
		ctx, err := newTestContext(stub)
		require.NoError(t, err)
		require.NoError(t, contract.SubmitMerkleRoot(ctx, roots[i], "IN-DL", 1))
		endTx(stub.MockStub, fmt.Sprintf("tx%d", i+1))
		require.NotNil(t, drainEvent(stub.MockStub))
	}

	startTx(stub.MockStub, "txQ", 1300)
	ctxQ, err := newTestContext(stub)
	require.NoError(t, err)
	page, err := contract.GetAnchorsByRegion(ctxQ, "IN-DL", 1050, 1250, 25, "")
	require.NoError(t, err)
	require.NotNil(t, page)
	assert.Equal(t, 2, page.Count)
	endTx(stub.MockStub, "txQ")
}

func TestGetAnchorsByRegion_PageSizeEnforced_Max100(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	for i := 0; i < 105; i++ {
		root := fmt.Sprintf("%064x", i)
		startTx(stub.MockStub, fmt.Sprintf("tx%d", i), 2000)
		ctx, err := newTestContext(stub)
		require.NoError(t, err)
		require.NoError(t, contract.SubmitMerkleRoot(ctx, root, "IN-DL", 1))
		endTx(stub.MockStub, fmt.Sprintf("tx%d", i))
		require.NotNil(t, drainEvent(stub.MockStub))
	}

	startTx(stub.MockStub, "txQ", 3000)
	ctxQ, err := newTestContext(stub)
	require.NoError(t, err)
	page, err := contract.GetAnchorsByRegion(ctxQ, "IN-DL", 0, 4000, 1000, "")
	require.NoError(t, err)
	require.NotNil(t, page)
	assert.Equal(t, 100, page.Count)
	endTx(stub.MockStub, "txQ")
}

func TestGetAnchorsByRegion_InvalidTimeRange_ReturnsError(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "txQ", 3000)
	ctxQ, err := newTestContext(stub)
	require.NoError(t, err)
	_, err = contract.GetAnchorsByRegion(ctxQ, "IN-DL", 10, 10, 25, "")
	require.Error(t, err)
	endTx(stub.MockStub, "txQ")
}

func TestInitLedger_FirstCall_SeedsData(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 1111)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.InitLedger(ctx))
	endTx(stub.MockStub, "tx1")

	seedMerkleRoot := strings.Repeat("a", 64)
	anchorKey, err := stub.CreateCompositeKey(KeyPrefixAnchor, []string{seedMerkleRoot})
	require.NoError(t, err)
	b, err := stub.GetState(anchorKey)
	require.NoError(t, err)
	require.NotNil(t, b)

	seedComplaintID := "COMPLAINT_SEED_1"
	escKey, err := stub.CreateCompositeKey(KeyPrefixEscalation, []string{seedComplaintID, "1111"})
	require.NoError(t, err)
	b, err = stub.GetState(escKey)
	require.NoError(t, err)
	require.NotNil(t, b)

	resKey, err := stub.CreateCompositeKey(KeyPrefixResolution, []string{seedComplaintID})
	require.NoError(t, err)
	b, err = stub.GetState(resKey)
	require.NoError(t, err)
	require.NotNil(t, b)
}

func TestInitLedger_SecondCall_Idempotent(t *testing.T) {
	stub := &richQueryStub{MockStub: newTestStub(t, "RoadWatchMSP")}
	contract := new(ComplaintAnchorContract)

	startTx(stub.MockStub, "tx1", 1111)
	ctx, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.InitLedger(ctx))
	endTx(stub.MockStub, "tx1")

	countAfterFirst := len(stub.State)

	startTx(stub.MockStub, "tx2", 1112)
	ctx2, err := newTestContext(stub)
	require.NoError(t, err)
	require.NoError(t, contract.InitLedger(ctx2))
	endTx(stub.MockStub, "tx2")

	assert.Equal(t, countAfterFirst, len(stub.State))
}
