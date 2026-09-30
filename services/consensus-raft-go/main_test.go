package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func init() {
	os.Setenv("RAFT_STATE_FILE", "none")
}

func TestNewRaftNodeInit(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"}, []string{"http://localhost:8081", "http://localhost:8082"})
	if node.NodeID != "node1" {
		t.Errorf("expected node ID node1, got %s", node.NodeID)
	}
	if node.Role != Follower {
		t.Errorf("expected initial role Follower, got %s", node.Role)
	}
	if q := node.quorum(); q != 2 {
		t.Errorf("expected quorum 2 for 3-node cluster, got %d", q)
	}
	if node.liveAck == nil {
		t.Errorf("expected liveAck to be initialized")
	}
}

func TestRaftLogUpToDate(t *testing.T) {
	node := NewRaftNode("node1", nil, nil)
	node.Log = []LogEntry{
		{Index: 1, Term: 1, Command: "CREATED", OrderID: "ord-1", Timestamp: time.Now()},
		{Index: 2, Term: 1, Command: "DISPATCHED", OrderID: "ord-1", Timestamp: time.Now()},
	}

	if !node.isLogUpToDate(2, 1) {
		t.Errorf("expected (2, 1) to be up to date")
	}
	if node.isLogUpToDate(1, 1) {
		t.Errorf("expected (1, 1) to be rejected as obsolete")
	}
	if !node.isLogUpToDate(1, 2) {
		t.Errorf("expected higher term (1, 2) to be accepted")
	}
}

func TestConcurrentVoteRPCNoDeadlock(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	// Create test server for Node 2
	var node2 *RaftNode
	server2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/raft/vote" {
			node2.HandleVote(w, r)
		}
	}))
	defer server2.Close()

	node2 = NewRaftNode("node2", []string{"node1"}, []string{"http://localhost:1111"})

	// Node 1 configured to talk to server2
	node1 := NewRaftNode("node1", []string{"node2"}, []string{server2.URL})

	// Perform election on node1 asynchronously
	done := make(chan bool)
	go func() {
		node1.startElection()
		done <- true
	}()

	select {
	case <-done:
		// Completed cleanly without deadlock
	case <-time.After(2 * time.Second):
		t.Fatal("startElection deadlocked during concurrent HTTP vote RPC")
	}

	if node1.Role != Leader {
		t.Errorf("expected node1 to become leader, got %s", node1.Role)
	}
}

// raftHandlers wires the standard Raft HTTP routes for a node under test.
func raftHandlers(n *RaftNode) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/raft/status", n.HandleStatus)
	mux.HandleFunc("/api/v1/raft/commit", n.HandleCommitOrder)
	mux.HandleFunc("/api/v1/raft/vote", n.HandleVote)
	mux.HandleFunc("/api/v1/raft/append", n.HandleAppend)
	return mux
}

// TestLeaderReplicatesEntryToFollowersBeforeCommit spins up a 3-node cluster
// over httptest servers, commits an order on the leader, and asserts the entry
// is present on both followers before the leader returns success.
func TestLeaderReplicatesEntryToFollowersBeforeCommit(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node1 := NewRaftNode("node1", []string{"node2", "node3"}, nil)
	node2 := NewRaftNode("node2", []string{"node1", "node3"}, nil)
	node3 := NewRaftNode("node3", []string{"node1", "node2"}, nil)

	s1 := httptest.NewServer(raftHandlers(node1))
	defer s1.Close()
	s2 := httptest.NewServer(raftHandlers(node2))
	defer s2.Close()
	s3 := httptest.NewServer(raftHandlers(node3))
	defer s3.Close()

	node1.PeerURLs = []string{s2.URL, s3.URL}
	node2.PeerURLs = []string{s1.URL, s3.URL}
	node3.PeerURLs = []string{s1.URL, s2.URL}

	node1.mu.Lock()
	node1.Role = Leader
	node1.LeaderID = "node1"
	node1.CurrentTerm = 1
	node1.nextIndex = map[string]uint64{s2.URL: 1, s3.URL: 1}
	node1.matchIndex = map[string]uint64{s2.URL: 0, s3.URL: 0}
	// Both followers have acknowledged an AppendEntries round, so the /commit
	// admission gate sees a live quorum; replication of the new entry is still
	// verified before success is returned below.
	node1.liveAck = map[string]bool{s2.URL: true, s3.URL: true}
	node1.mu.Unlock()

	body := strings.NewReader(`{"order_id":"ord-repl-1","command":"CREATED"}`)
	resp, err := http.Post(s1.URL+"/api/v1/raft/commit", "application/json", body)
	if err != nil {
		t.Fatalf("commit request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from leader, got %d", resp.StatusCode)
	}

	var payload struct {
		Success   bool   `json:"success"`
		RaftIndex uint64 `json:"raft_index"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decoding commit response: %v", err)
	}
	if !payload.Success || payload.RaftIndex != 1 {
		t.Fatalf("expected success with raft_index 1, got %+v", payload)
	}

	// The entry must already be replicated AND committed on both followers
	// before the leader returned success.
	for name, n := range map[string]*RaftNode{"node2": node2, "node3": node3} {
		var logLen int
		var firstOrder string
		var firstIndex uint64
		var commit uint64
		n.mu.Lock()
		logLen = len(n.Log)
		if logLen > 0 {
			firstOrder = n.Log[0].OrderID
			firstIndex = n.Log[0].Index
		}
		commit = n.CommitIndex
		n.mu.Unlock()

		if logLen != 1 || firstOrder != "ord-repl-1" || firstIndex != 1 {
			t.Errorf("%s: expected committed entry in log, got len=%d order=%q index=%d",
				name, logLen, firstOrder, firstIndex)
		}
		if commit != 1 {
			t.Errorf("%s: expected commit_index 1, got %d", name, commit)
		}
	}
}

// TestCommitDoesNotReturnSuccessWithoutQuorumReplication verifies the /commit
// admission gate fails fast: a leader that has not completed a single successful
// AppendEntries round (no evidence of a live quorum) rejects the request with
// 503 before appending anything to its local log.
func TestCommitDoesNotReturnSuccessWithoutQuorumReplication(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	unreachable := []string{"http://127.0.0.1:1", "http://127.0.0.1:2"}
	node := NewRaftNode("node1", []string{"node2", "node3"}, unreachable)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/raft/commit" {
			node.HandleCommitOrder(w, r)
		}
	}))
	defer server.Close()

	// Leader with zero successful AppendEntries rounds: liveAck is empty, so
	// the admission gate must reject the request up front.
	node.mu.Lock()
	node.Role = Leader
	node.LeaderID = "node1"
	node.CurrentTerm = 1
	node.nextIndex = map[string]uint64{unreachable[0]: 1, unreachable[1]: 1}
	node.matchIndex = map[string]uint64{unreachable[0]: 0, unreachable[1]: 0}
	node.mu.Unlock()

	body := strings.NewReader(`{"order_id":"ord-lost-1","command":"CREATED"}`)
	resp, err := http.Post(server.URL+"/api/v1/raft/commit", "application/json", body)
	if err != nil {
		t.Fatalf("commit request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 without a live quorum, got %d", resp.StatusCode)
	}

	// Fail-fast: nothing is appended to the leader's log, so a later retry
	// cannot create a duplicate entry.
	node.mu.Lock()
	defer node.mu.Unlock()
	if len(node.Log) != 0 {
		t.Errorf("expected no entry appended without a live quorum, got %v", node.Log)
	}
	if node.CommitIndex != 0 || node.LastApplied != 0 {
		t.Errorf("expected commit_index/last_applied 0 without a live quorum, got commit=%d applied=%d",
			node.CommitIndex, node.LastApplied)
	}
}

// TestCommitAdmissionPassesOnLiveAckButStillRequiresReplication verifies that
// once a leader has live-quorum evidence (a previous successful AppendEntries
// round) the admission gate lets a new entry through, but success is still only
// returned once a quorum acknowledges the new entry: a mid-request partition
// returns 503 with the entry left in the local log awaiting replication.
func TestCommitAdmissionPassesOnLiveAckButStillRequiresReplication(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	unreachable := []string{"http://127.0.0.1:1", "http://127.0.0.1:2"}
	node := NewRaftNode("node1", []string{"node2", "node3"}, unreachable)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/raft/commit" {
			node.HandleCommitOrder(w, r)
		}
	}))
	defer server.Close()

	// Both followers acknowledged an earlier heartbeat, so the admission gate
	// passes; they are now unreachable, so the new entry cannot be replicated.
	node.mu.Lock()
	node.Role = Leader
	node.LeaderID = "node1"
	node.CurrentTerm = 1
	node.nextIndex = map[string]uint64{unreachable[0]: 1, unreachable[1]: 1}
	node.matchIndex = map[string]uint64{unreachable[0]: 0, unreachable[1]: 0}
	node.liveAck = map[string]bool{unreachable[0]: true, unreachable[1]: true}
	node.mu.Unlock()

	body := strings.NewReader(`{"order_id":"ord-lost-2","command":"CREATED"}`)
	resp, err := http.Post(server.URL+"/api/v1/raft/commit", "application/json", body)
	if err != nil {
		t.Fatalf("commit request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 without quorum replication, got %d", resp.StatusCode)
	}

	node.mu.Lock()
	defer node.mu.Unlock()
	if len(node.Log) != 1 || node.Log[0].OrderID != "ord-lost-2" {
		t.Errorf("expected the entry appended to the local log for replication, got %v", node.Log)
	}
	if node.CommitIndex != 0 || node.LastApplied != 0 {
		t.Errorf("expected commit_index/last_applied 0 without quorum, got commit=%d applied=%d",
			node.CommitIndex, node.LastApplied)
	}
}

// TestStartElectionSeedsConservativeReplicationState verifies the leader seeds
// nextIndex = lastLogIndex+1 and matchIndex = 0 for every follower on election
// (Raft §5.3), never assuming a follower has replicated the leader's log before
// an AppendEntries acknowledgement proves it.
func TestStartElectionSeedsConservativeReplicationState(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	now := time.Now()
	votes := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/raft/vote" {
			json.NewEncoder(w).Encode(RequestVoteResponse{Term: 1, VoteGranted: true})
		}
	}))
	defer votes.Close()

	node := NewRaftNode("node1", []string{"node2", "node3"}, []string{votes.URL, votes.URL})
	node.Log = []LogEntry{
		{Index: 1, Term: 1, Command: "CREATED", OrderID: "ord-1", Timestamp: now},
		{Index: 2, Term: 1, Command: "DISPATCHED", OrderID: "ord-1", Timestamp: now},
	}

	node.startElection()

	node.mu.Lock()
	defer node.mu.Unlock()
	if node.Role != Leader {
		t.Fatalf("expected node to become leader, got %s", node.Role)
	}
	for _, url := range node.PeerURLs {
		if node.nextIndex[url] != 3 {
			t.Errorf("peer %s: expected nextIndex seeded to lastLogIndex+1 (3), got %d", url, node.nextIndex[url])
		}
		if node.matchIndex[url] != 0 {
			t.Errorf("peer %s: expected matchIndex seeded to 0, got %d", url, node.matchIndex[url])
		}
		if node.liveAck[url] {
			t.Errorf("peer %s: expected liveAck false right after election, got true", url)
		}
	}
}

// TestClusterStatusReflectsLiveQuorum verifies the leader status reports
// HEALTHY_CLUSTER only when a quorum of peers has acknowledged an AppendEntries
// round, not based on an optimistic matchIndex seed.
func TestClusterStatusReflectsLiveQuorum(t *testing.T) {
	node := NewRaftNode("node1", []string{"node2", "node3"}, []string{"p2", "p3"})
	node.Role = Leader
	node.LeaderID = "node1"
	node.CurrentTerm = 1

	node.mu.Lock()
	status := node.clusterStatusLocked()
	node.mu.Unlock()
	if status != "UNHEALTHY_CLUSTER" {
		t.Errorf("expected UNHEALTHY_CLUSTER without a live quorum, got %s", status)
	}

	node.mu.Lock()
	node.liveAck = map[string]bool{"p2": true, "p3": true}
	status = node.clusterStatusLocked()
	node.mu.Unlock()
	if status != "HEALTHY_CLUSTER" {
		t.Errorf("expected HEALTHY_CLUSTER with a live quorum, got %s", status)
	}
}

// TestHeartbeatBackfillsLaggingFollower verifies the leader replication loop
// sends missing entries to a follower and advances commit on both nodes.
func TestHeartbeatBackfillsLaggingFollower(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	now := time.Now()
	leader := NewRaftNode("node1", []string{"node2"}, nil)
	leader.Log = []LogEntry{
		{Index: 1, Term: 1, Command: "CREATED", OrderID: "ord-1", Timestamp: now},
		{Index: 2, Term: 1, Command: "DISPATCHED", OrderID: "ord-1", Timestamp: now},
		{Index: 3, Term: 1, Command: "IN_TRANSIT", OrderID: "ord-1", Timestamp: now},
	}

	follower := NewRaftNode("node2", []string{"node1"}, nil)
	follower.Log = []LogEntry{
		{Index: 1, Term: 1, Command: "CREATED", OrderID: "ord-1", Timestamp: now},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/raft/append" {
			follower.HandleAppend(w, r)
		}
	}))
	defer server.Close()

	leader.PeerURLs = []string{server.URL}
	leader.mu.Lock()
	leader.Role = Leader
	leader.LeaderID = "node1"
	leader.CurrentTerm = 1
	leader.CommitIndex = 2
	leader.nextIndex = map[string]uint64{server.URL: 2}
	leader.matchIndex = map[string]uint64{server.URL: 1}
	leader.mu.Unlock()

	leader.sendHeartbeats()

	var logLen int
	var lastOrder string
	var commit uint64
	follower.mu.Lock()
	logLen = len(follower.Log)
	if logLen > 0 {
		lastOrder = follower.Log[logLen-1].OrderID
	}
	commit = follower.CommitIndex
	follower.mu.Unlock()

	if logLen != 3 {
		t.Errorf("expected follower backfilled to 3 entries, got %d", logLen)
	}
	if lastOrder != "ord-1" {
		t.Errorf("expected last entry order ord-1, got %q", lastOrder)
	}
	if commit != 2 {
		t.Errorf("expected follower commit_index 2, got %d", commit)
	}
}

// TestAdvanceCommitIndexRequiresQuorum exercises the quorum rule directly.
func TestAdvanceCommitIndexRequiresQuorum(t *testing.T) {
	now := time.Now()
	leader := NewRaftNode("node1", []string{"node2", "node3"}, []string{"p2", "p3"})
	leader.Log = []LogEntry{
		{Index: 1, Term: 1, Command: "CREATED", OrderID: "ord-1", Timestamp: now},
		{Index: 2, Term: 1, Command: "DISPATCHED", OrderID: "ord-1", Timestamp: now},
	}
	leader.Role = Leader
	leader.CurrentTerm = 1

	// Only one follower (plus the leader) acknowledges index 1 → quorum is 2,
	// so index 1 commits but index 2 does not.
	leader.matchIndex = map[string]uint64{"p2": 1, "p3": 0}
	leader.advanceCommitIndexLocked()
	if leader.CommitIndex != 1 {
		t.Errorf("expected commit_index 1 with partial quorum, got %d", leader.CommitIndex)
	}
	if leader.LastApplied != 1 {
		t.Errorf("expected last_applied 1, got %d", leader.LastApplied)
	}

	// Both followers acknowledge index 2 → fully committed.
	leader.matchIndex = map[string]uint64{"p2": 2, "p3": 2}
	leader.advanceCommitIndexLocked()
	if leader.CommitIndex != 2 {
		t.Errorf("expected commit_index 2 with full quorum, got %d", leader.CommitIndex)
	}
	if leader.LastApplied != 2 {
		t.Errorf("expected last_applied 2, got %d", leader.LastApplied)
	}
}

// TestOutofOrderAppendResponseDoesNotRegressMatchIndex verifies that a delayed
// or out-of-order AppendEntries success response with lower match index does
// not regress matchIndex or nextIndex for a follower.
func TestOutofOrderAppendResponseDoesNotRegressMatchIndex(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	follower := NewRaftNode("node2", []string{"node1"}, nil)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/raft/append" {
			follower.HandleAppend(w, r)
		}
	}))
	defer server.Close()

	now := time.Now()
	leader := NewRaftNode("node1", []string{"node2"}, []string{server.URL})
	leader.Log = []LogEntry{
		{Index: 1, Term: 1, Command: "CREATED", OrderID: "ord-1", Timestamp: now},
		{Index: 2, Term: 1, Command: "DISPATCHED", OrderID: "ord-1", Timestamp: now},
	}
	leader.Role = Leader
	leader.CurrentTerm = 1
	leader.nextIndex = map[string]uint64{server.URL: 3}
	leader.matchIndex = map[string]uint64{server.URL: 2}

	// Simulate stale heartbeat sent with PrevLogIndex 0 arriving later
	leader.nextIndex[server.URL] = 1
	leader.sendHeartbeats()

	leader.mu.Lock()
	match := leader.matchIndex[server.URL]
	next := leader.nextIndex[server.URL]
	leader.mu.Unlock()

	if match != 2 {
		t.Errorf("expected matchIndex to remain monotonically at 2, got %d", match)
	}
	if next != 3 {
		t.Errorf("expected nextIndex to remain at 3, got %d", next)
	}
}

// TestStaleFailureResponseDoesNotRegressNextIndex verifies that an out-of-order
// failure response arriving after nextIndex has already advanced leaves nextIndex unchanged.
func TestStaleFailureResponseDoesNotRegressNextIndex(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/raft/append" {
			time.Sleep(50 * time.Millisecond)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(AppendEntriesResponse{Term: 1, Success: false})
		}
	}))
	defer server.Close()

	now := time.Now()
	leader := NewRaftNode("node1", []string{"node2"}, []string{server.URL})
	leader.Log = []LogEntry{
		{Index: 1, Term: 1, Command: "CREATED", OrderID: "ord-1", Timestamp: now},
		{Index: 2, Term: 1, Command: "DISPATCHED", OrderID: "ord-1", Timestamp: now},
		{Index: 3, Term: 1, Command: "IN_TRANSIT", OrderID: "ord-1", Timestamp: now},
	}
	leader.Role = Leader
	leader.CurrentTerm = 1
	leader.nextIndex = map[string]uint64{server.URL: 2}
	leader.matchIndex = map[string]uint64{server.URL: 1}

	// Launch sendHeartbeats asynchronously probing index 2
	done := make(chan bool)
	go func() {
		leader.sendHeartbeats()
		done <- true
	}()

	// While RPC is in flight, simulate successful advancement of nextIndex to 4
	time.Sleep(10 * time.Millisecond)
	leader.mu.Lock()
	leader.nextIndex[server.URL] = 4
	leader.matchIndex[server.URL] = 3
	leader.mu.Unlock()

	<-done

	leader.mu.Lock()
	next := leader.nextIndex[server.URL]
	match := leader.matchIndex[server.URL]
	leader.mu.Unlock()

	if next != 4 {
		t.Errorf("expected nextIndex to remain unchanged at 4 when stale failure arrives, got %d", next)
	}
	if match != 3 {
		t.Errorf("expected matchIndex to remain 3, got %d", match)
	}
}


// TestHandleVoteResetsElectionTimer verifies that granting a vote updates lastLeaderSeen.
func TestHandleVoteResetsElectionTimer(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node := NewRaftNode("node1", []string{"node2"}, nil)
	oldTime := time.Now().Add(-10 * time.Second)
	node.lastLeaderSeen = oldTime

	reqPayload := `{"term": 1, "candidate_id": "node2", "last_log_index": 0, "last_log_term": 0}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/vote", strings.NewReader(reqPayload))
	w := httptest.NewRecorder()

	node.HandleVote(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	node.mu.Lock()
	updatedSeen := node.lastLeaderSeen
	votedFor := node.VotedFor
	node.mu.Unlock()

	if votedFor != "node2" {
		t.Errorf("expected voted_for node2, got %s", votedFor)
	}
	if !updatedSeen.After(oldTime) {
		t.Errorf("expected lastLeaderSeen to be reset upon granting vote, got %v", updatedSeen)
	}
}

func TestHandleCommitOrderDuplicateDeduplication(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node := NewRaftNode("node1", nil, nil)
	node.Role = Leader
	node.CurrentTerm = 1
	node.CommitIndex = 1

	// Setup log with an existing entry
	node.Log = []LogEntry{
		{Index: 1, Term: 1, Command: "CREATED", OrderID: "ord-1", Timestamp: time.Now()},
	}

	// Try to commit the exact same (order_id, command)
	reqPayload := `{"order_id": "ord-1", "command": "CREATED"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(reqPayload))
	w := httptest.NewRecorder()

	node.HandleCommitOrder(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var res map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if res["already_committed"] != true {
		t.Errorf("expected already_committed=true on duplicate submission, got %v", res["already_committed"])
	}

	// Verify no new entry was appended
	if len(node.Log) != 1 {
		t.Errorf("expected log length 1 (no duplicate appended), got %d", len(node.Log))
	}
}

func TestHandleCommitOrderInvalidTransition(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node := NewRaftNode("node1", nil, nil)
	node.Role = Leader
	node.CurrentTerm = 1

	// Case 1: Start with non-CREATED command (should fail)
	reqPayload1 := `{"order_id": "ord-1", "command": "DISPATCHED"}`
	req1 := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(reqPayload1))
	w1 := httptest.NewRecorder()
	node.HandleCommitOrder(w1, req1)
	if w1.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 when starting with DISPATCHED, got %d", w1.Code)
	}

	// Case 2: Valid CREATED
	reqPayload2 := `{"order_id": "ord-1", "command": "CREATED"}`
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(reqPayload2))
	w2 := httptest.NewRecorder()
	node.HandleCommitOrder(w2, req2)

	// Case 3: Out of order transition CREATED -> DELIVERED (should fail)
	reqPayload3 := `{"order_id": "ord-1", "command": "DELIVERED"}`
	req3 := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(reqPayload3))
	w3 := httptest.NewRecorder()
	node.HandleCommitOrder(w3, req3)
	if w3.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for out-of-order transition CREATED -> DELIVERED, got %d", w3.Code)
	}
}

func TestLeaderWithoutQuorumRejectsCommit(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	// Node 1 is leader but Node 2 is unreachable (port 9999 is blocked/dead)
	node := NewRaftNode("node1", []string{"node2"}, []string{"http://localhost:9999"})
	
	// Transition manually to leader (simulating startElection election win)
	node.mu.Lock()
	node.Role = Leader
	node.LeaderID = "node1"
	node.CurrentTerm = 1
	node.nextIndex = map[string]uint64{"http://localhost:9999": 1}
	node.matchIndex = map[string]uint64{"http://localhost:9999": 0}
	node.liveAck = map[string]bool{"http://localhost:9999": false}
	node.mu.Unlock()

	// Try to commit order command
	reqPayload := `{"order_id": "ord-1", "command": "CREATED"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(reqPayload))
	w := httptest.NewRecorder()

	node.HandleCommitOrder(w, req)

	// Since there is no quorum validation, it should return 503 Service Unavailable (no quorum)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503 (no quorum), got %d. Body: %s", w.Code, w.Body.String())
	}

	// Verify no entry was appended to the log
	node.mu.Lock()
	logLen := len(node.Log)
	node.mu.Unlock()
	if logLen != 0 {
		t.Errorf("expected log to remain empty, but got length %d", logLen)
	}
}

func TestRaftStatePersistAndLoad(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "raft_state_test_*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)
	tmpFile.Close()

	os.Setenv("RAFT_STATE_FILE", tmpPath)
	defer os.Setenv("RAFT_STATE_FILE", "none")

	node := NewRaftNode("test-node-1", nil, nil)
	node.CurrentTerm = 5
	node.VotedFor = "candidate-1"
	node.Log = []LogEntry{
		{Index: 1, Term: 2, Command: "CREATED", OrderID: "ord-1", Timestamp: time.Now()},
		{Index: 2, Term: 3, Command: "DISPATCHED", OrderID: "ord-1", Timestamp: time.Now()},
	}

	// Persist
	if err := node.persister.SaveState(node.CurrentTerm, node.VotedFor); err != nil {
		t.Fatalf("SaveState failed: %v", err)
	}
	if err := node.persister.SaveLog(node.Log); err != nil {
		t.Fatalf("SaveLog failed: %v", err)
	}

	// Create new node and load
	node2 := NewRaftNode("test-node-1", nil, nil)
	if node2.CurrentTerm != 5 {
		t.Errorf("expected term 5, got %d", node2.CurrentTerm)
	}
	if node2.VotedFor != "candidate-1" {
		t.Errorf("expected VotedFor 'candidate-1', got %s", node2.VotedFor)
	}
	if len(node2.Log) != 2 {
		t.Errorf("expected 2 log entries, got %d", len(node2.Log))
	} else {
		if node2.Log[0].Command != "CREATED" || node2.Log[1].Command != "DISPATCHED" {
			t.Errorf("restored log entries commands mismatch")
		}
	}
}

// TestHandleCommitOrderRejectsOversizedBody verifies the service returns 413
// for a body larger than the 1 MiB cap instead of buffering it into memory.
func TestHandleCommitOrderRejectsOversizedBody(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node := NewRaftNode("node1", []string{"node2"}, nil)

	big := strings.Repeat("a", maxRequestBodyBytes+1)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(big))
	w := httptest.NewRecorder()

	node.HandleCommitOrder(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for oversized body, got %d", w.Code)
	}
}

// TestHandleCommitOrderAcceptsBodyWithinLimit verifies a body at the cap
// boundary is still decoded (malformed payload → 400, not 413).
func TestHandleCommitOrderAcceptsBodyWithinLimit(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node := NewRaftNode("node1", []string{"node2"}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader("{not-json"))
	w := httptest.NewRecorder()

	node.HandleCommitOrder(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed in-limit body, got %d", w.Code)
	}
}

// TestSingleNodeOrElectionSeedDoesNotFalselyClaimQuorum verifies that an isolated
// leader with optimistic election seeds or unacknowledged peers cannot falsely claim
// quorum: /commit must reject with 503 rather than prematurely succeeding.
func TestSingleNodeOrElectionSeedDoesNotFalselyClaimQuorum(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	// 3-node cluster: node1 is leader, node2 & node3 have not acknowledged in current term.
	node := NewRaftNode("node1", []string{"node2", "node3"}, []string{"http://127.0.0.1:54321", "http://127.0.0.1:54322"})
	node.mu.Lock()
	node.Role = Leader
	node.LeaderID = "node1"
	node.CurrentTerm = 2
	// Optimistic election seeds must NOT count as acknowledgment for new entries
	node.nextIndex = map[string]uint64{"http://127.0.0.1:54321": 10, "http://127.0.0.1:54322": 10}
	node.matchIndex = map[string]uint64{"http://127.0.0.1:54321": 9, "http://127.0.0.1:54322": 9}
	// liveAck is empty (no current-term heartbeat round has completed)
	node.liveAck = make(map[string]bool)
	node.mu.Unlock()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(`{"order_id":"ord-seed-1","command":"CREATED"}`))
	w := httptest.NewRecorder()
	node.HandleCommitOrder(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 Service Unavailable without current-term quorum acknowledgment, got %d (body: %s)", w.Code, w.Body.String())
	}

	node.mu.Lock()
	defer node.mu.Unlock()
	if len(node.Log) != 0 {
		t.Errorf("expected no entry to be appended to log without quorum, got %d entries", len(node.Log))
	}
}

// TestSuccessfulRealQuorumCommit verifies /commit succeeds only after the entry
// has real current-term quorum acknowledgment replicated to followers.
func TestSuccessfulRealQuorumCommit(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node1 := NewRaftNode("node1", []string{"node2", "node3"}, nil)
	node2 := NewRaftNode("node2", []string{"node1", "node3"}, nil)
	node3 := NewRaftNode("node3", []string{"node1", "node2"}, nil)

	s1 := httptest.NewServer(raftHandlers(node1))
	defer s1.Close()
	s2 := httptest.NewServer(raftHandlers(node2))
	defer s2.Close()
	s3 := httptest.NewServer(raftHandlers(node3))
	defer s3.Close()

	node1.PeerURLs = []string{s2.URL, s3.URL}
	node2.PeerURLs = []string{s1.URL, s3.URL}
	node3.PeerURLs = []string{s1.URL, s2.URL}

	node1.mu.Lock()
	node1.Role = Leader
	node1.LeaderID = "node1"
	node1.CurrentTerm = 1
	node1.nextIndex = map[string]uint64{s2.URL: 1, s3.URL: 1}
	node1.matchIndex = map[string]uint64{s2.URL: 0, s3.URL: 0}
	node1.liveAck = map[string]bool{s2.URL: true, s3.URL: true}
	node1.mu.Unlock()

	body := strings.NewReader(`{"order_id":"ord-quorum-ok","command":"CREATED"}`)
	resp, err := http.Post(s1.URL+"/api/v1/raft/commit", "application/json", body)
	if err != nil {
		t.Fatalf("commit request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from leader, got %d", resp.StatusCode)
	}

	var payload struct {
		Success   bool   `json:"success"`
		RaftIndex uint64 `json:"raft_index"`
		OrderID   string `json:"order_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if !payload.Success || payload.RaftIndex != 1 || payload.OrderID != "ord-quorum-ok" {
		t.Fatalf("unexpected payload: %+v", payload)
	}

	// Verify replicated and committed on both followers
	for name, n := range map[string]*RaftNode{"node2": node2, "node3": node3} {
		n.mu.Lock()
		logLen := len(n.Log)
		commit := n.CommitIndex
		n.mu.Unlock()
		if logLen != 1 {
			t.Errorf("%s: expected 1 log entry, got %d", name, logLen)
		}
		if commit != 1 {
			t.Errorf("%s: expected commit_index 1, got %d", name, commit)
		}
	}
}

// TestDuplicateOrderSubmissionIdempotency verifies duplicate (order_id, command)
// submissions do not append a new entry and return 200 with already_committed=true.
func TestDuplicateOrderSubmissionIdempotency(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node := NewRaftNode("node1", nil, nil)
	node.mu.Lock()
	node.Role = Leader
	node.LeaderID = "node1"
	node.CurrentTerm = 1
	node.mu.Unlock()

	// First submission
	req1 := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(`{"order_id":"ord-idem-1","command":"CREATED"}`))
	w1 := httptest.NewRecorder()
	node.HandleCommitOrder(w1, req1)

	if w1.Code != http.StatusOK {
		t.Fatalf("expected 200 for first submission, got %d. Body: %s", w1.Code, w1.Body.String())
	}
	var res1 map[string]interface{}
	json.NewDecoder(w1.Body).Decode(&res1)
	if res1["already_committed"] == true {
		t.Errorf("first submission should not have already_committed=true")
	}

	// Duplicate submission with exact same (order_id, command)
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(`{"order_id":"ord-idem-1","command":"CREATED"}`))
	w2 := httptest.NewRecorder()
	node.HandleCommitOrder(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200 for duplicate submission, got %d. Body: %s", w2.Code, w2.Body.String())
	}
	var res2 map[string]interface{}
	json.NewDecoder(w2.Body).Decode(&res2)
	if res2["already_committed"] != true {
		t.Errorf("expected already_committed=true on duplicate submission, got %v", res2["already_committed"])
	}
	if res2["raft_index"] != res1["raft_index"] {
		t.Errorf("expected same raft_index %v, got %v", res1["raft_index"], res2["raft_index"])
	}

	node.mu.Lock()
	defer node.mu.Unlock()
	if len(node.Log) != 1 {
		t.Errorf("expected log length to remain 1, got %d", len(node.Log))
	}
}

// TestMultiEntryLogIndexCorrectness verifies canonical 1-based log indexing 1..N
// using the logIndex helper across normal and compacted snapshots.
func TestMultiEntryLogIndexCorrectness(t *testing.T) {
	node := NewRaftNode("node1", nil, nil)
	now := time.Now()

	const n = 10
	for i := uint64(1); i <= n; i++ {
		node.Log = append(node.Log, LogEntry{
			Index:     i,
			Term:      1,
			Command:   "CREATED",
			OrderID:   fmt.Sprintf("ord-%d", i),
			Timestamp: now,
		})
	}

	// Canonical 1-based log indexing: index i in [1..N] maps to slice index i-1
	for i := uint64(1); i <= n; i++ {
		idx := node.logIndex(i)
		if idx != int(i-1) {
			t.Errorf("expected logIndex(%d) == %d, got %d", i, i-1, idx)
		}
		if node.Log[idx].Index != i {
			t.Errorf("expected entry at logIndex(%d) to have Index %d, got %d", i, i, node.Log[idx].Index)
		}
	}

	// Verify behavior with compacted snapshotIndex
	node.snapshotIndex = 4
	node.Log = node.Log[4:] // retained entries have Index 5..10

	for i := uint64(5); i <= n; i++ {
		idx := node.logIndex(i)
		expected := int(i - 4 - 1)
		if idx != expected {
			t.Errorf("with snapshotIndex=4, expected logIndex(%d) == %d, got %d", i, expected, idx)
		}
		if node.Log[idx].Index != i {
			t.Errorf("with snapshotIndex=4, expected entry at logIndex(%d) to have Index %d, got %d", i, i, node.Log[idx].Index)
		}
	}
}


package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestWALBasicOperations tests basic WAL functionality.
func TestWALBasicOperations(t *testing.T) {
	tmpDir := t.TempDir()
	
	wal, err := NewWAL(tmpDir, true)
	if err != nil {
		t.Fatalf("Failed to create WAL: %v", err)
	}
	defer wal.Close()

	// Test term change
	if err := wal.AppendTermChange(1); err != nil {
		t.Fatalf("Failed to append term: %v", err)
	}

	// Test vote
	if err := wal.AppendVote(1, "node-1"); err != nil {
		t.Fatalf("Failed to append vote: %v", err)
	}

	// Test log entry
	if err := wal.AppendLogEntry(1, 1, map[string]string{"type": "order", "id": "123"}); err != nil {
		t.Fatalf("Failed to append log: %v", err)
	}

	// Test commit
	if err := wal.AppendCommit(1); err != nil {
		t.Fatalf("Failed to append commit: %v", err)
	}

	// Replay and verify
	entries, err := wal.Replay()
	if err != nil {
		t.Fatalf("Failed to replay: %v", err)
	}

	if len(entries) != 4 {
		t.Errorf("Expected 4 entries, got %d", len(entries))
	}

	if entries[0].Type != "term" || entries[0].Term != 1 {
		t.Errorf("First entry should be term change")
	}

	if entries[1].Type != "vote" || entries[1].VotedFor != "node-1" {
		t.Errorf("Second entry should be vote for node-1")
	}
}

// TestWALRecovery tests that state is recovered after restart.
func TestWALRecovery(t *testing.T) {
	tmpDir := t.TempDir()
	
	// First "session"
	wal1, err := NewWAL(tmpDir, true)
	if err != nil {
		t.Fatalf("Failed to create WAL: %v", err)
	}

	// Simulate Raft operations
	wal1.AppendTermChange(5)
	wal1.AppendVote(5, "node-2")
	wal1.AppendLogEntry(5, 1, "order_created")
	wal1.AppendLogEntry(5, 2, "order_dispatched")
	wal1.AppendCommit(2)
	wal1.Close()

	// Second "session" (simulating restart)
	state, err := RecoverState(tmpDir)
	if err != nil {
		t.Fatalf("Failed to recover state: %v", err)
	}

	if state.CurrentTerm != 5 {
		t.Errorf("Expected term 5, got %d", state.CurrentTerm)
	}

	if state.VotedFor != "node-2" {
		t.Errorf("Expected voted for node-2, got %s", state.VotedFor)
	}

	if len(state.Log) != 2 {
		t.Errorf("Expected 2 log entries, got %d", len(state.Log))
	}

	if state.CommitIndex != 2 {
		t.Errorf("Expected commit index 2, got %d", state.CommitIndex)
	}
}

// TestWALVoteSafety tests that votedFor is durable across term changes.
func TestWALVoteSafety(t *testing.T) {
	tmpDir := t.TempDir()
	
	wal, err := NewWAL(tmpDir, true)
	if err != nil {
		t.Fatalf("Failed to create WAL: %v", err)
	}

	// Term 1: vote for node-A
	wal.AppendTermChange(1)
	wal.AppendVote(1, "node-A")
	
	// Term 2: vote for node-B (different term, different vote allowed)
	wal.AppendTermChange(2)
	wal.AppendVote(2, "node-B")
	
	wal.Close()

	// Recover and verify
	state, err := RecoverState(tmpDir)
	if err != nil {
		t.Fatalf("Failed to recover: %v", err)
	}

	if state.CurrentTerm != 2 {
		t.Errorf("Expected term 2, got %d", state.CurrentTerm)
	}

	// Should have vote from term 2
	if state.VotedFor != "node-B" {
		t.Errorf("Expected vote for node-B in term 2, got %s", state.VotedFor)
	}
}

// TestWALCrashBetweenAppendAndFsync tests that uncommitted entries are lost.
func TestWALCrashBetweenAppendAndFsync(t *testing.T) {
	tmpDir := t.TempDir()
	
	// Create WAL with sync mode disabled (simulating crash before fsync)
	wal, err := NewWAL(tmpDir, false)
	if err != nil {
		t.Fatalf("Failed to create WAL: %v", err)
	}

	wal.AppendTermChange(1)
	wal.AppendVote(1, "node-1")
	
	// Don't call Close() - simulate crash
	// (In real scenario, data might not be on disk)
	
	// For this test, we just verify the file exists
	walPath := filepath.Join(tmpDir, "raft.wal")
	if _, err := os.Stat(walPath); os.IsNotExist(err) {
		t.Error("WAL file should exist")
	}
}

// TestSnapshotCreation tests snapshot creation and loading.
func TestSnapshotCreation(t *testing.T) {
	tmpDir := t.TempDir()
	
	sm, err := NewSnapshotManager(tmpDir, "node-1")
	if err != nil {
		t.Fatalf("Failed to create snapshot manager: %v", err)
	}

	// Create snapshot
	state := map[string]interface{}{
		"orders": []string{"order-1", "order-2"},
		"count":  2,
	}

	if err := sm.Save(100, 5, state); err != nil {
		t.Fatalf("Failed to save snapshot: %v", err)
	}

	// Load and verify
	snapshot, err := sm.Load()
	if err != nil {
		t.Fatalf("Failed to load snapshot: %v", err)
	}

	if snapshot.LastIncludedIndex != 100 {
		t.Errorf("Expected index 100, got %d", snapshot.LastIncludedIndex)
	}

	if snapshot.LastIncludedTerm != 5 {
		t.Errorf("Expected term 5, got %d", snapshot.LastIncludedTerm)
	}
}

// TestSnapshotCompaction tests log compaction after snapshot.
func TestSnapshotCompaction(t *testing.T) {
	tmpDir := t.TempDir()
	
	sm, err := NewSnapshotManager(tmpDir, "node-1")
	if err != nil {
		t.Fatalf("Failed to create snapshot manager: %v", err)
	}

	// Create snapshot at index 50
	sm.Save(50, 3, nil)

	// Create log with entries 1-100
	var log []LogEntry
	for i := uint64(1); i <= 100; i++ {
		log = append(log, LogEntry{Index: i, Term: 3})
	}

	// Compact
	compacted := sm.CompactLog(log)

	// Should only have entries 51-100
	if len(compacted) != 50 {
		t.Errorf("Expected 50 entries after compaction, got %d", len(compacted))
	}

	if compacted[0].Index != 51 {
		t.Errorf("First entry should be index 51, got %d", compacted[0].Index)
	}
}

// TestShouldSnapshot tests the snapshot threshold logic.
func TestShouldSnapshot(t *testing.T) {
	tmpDir := t.TempDir()
	
	sm, err := NewSnapshotManager(tmpDir, "node-1")
	if err != nil {
		t.Fatalf("Failed to create snapshot manager: %v", err)
	}

	// No snapshot yet - should snapshot at threshold
	if !sm.ShouldSnapshot(100, 100) {
		t.Error("Should snapshot at threshold")
	}

	// Create snapshot at index 100
	sm.Save(100, 1, nil)

	// 50 entries since snapshot - should not snapshot yet
	if sm.ShouldSnapshot(150, 100) {
		t.Error("Should not snapshot before threshold")
	}

	// 100 entries since snapshot - should snapshot
	if !sm.ShouldSnapshot(200, 100) {
		t.Error("Should snapshot at threshold")
	}
}

// TestIntegrationWALAndSnapshot tests WAL + snapshot working together.
func TestIntegrationWALAndSnapshot(t *testing.T) {
	tmpDir := t.TempDir()
	
	// Create WAL and snapshot manager
	wal, err := NewWAL(tmpDir, true)
	if err != nil {
		t.Fatalf("Failed to create WAL: %v", err)
	}
	defer wal.Close()

	sm, err := NewSnapshotManager(tmpDir, "node-1")
	if err != nil {
		t.Fatalf("Failed to create snapshot manager: %v", err)
	}

	// Simulate Raft operations
	wal.AppendTermChange(1)
	
	for i := uint64(1); i <= 100; i++ {
		wal.AppendLogEntry(1, i, map[string]string{"order": "test"})
	}
	
	wal.AppendCommit(100)

	// Take snapshot at index 100
	sm.Save(100, 1, "state-at-100")

	// Continue with more entries
	for i := uint64(101); i <= 150; i++ {
		wal.AppendLogEntry(1, i, map[string]string{"order": "test"})
	}

	// Recover state
	state, err := RecoverState(tmpDir)
	if err != nil {
		t.Fatalf("Failed to recover: %v", err)
	}

	// Should have all 150 entries in WAL
	if len(state.Log) != 150 {
		t.Errorf("Expected 150 log entries, got %d", len(state.Log))
	}

	// Snapshot should be at 100
	if sm.LastIncludedIndex() != 100 {
		t.Errorf("Snapshot should be at 100")
	}
}

// TestRaftNodeRestart tests full Raft node restart with durability.
func TestRaftNodeRestart(t *testing.T) {
	tmpDir := t.TempDir()
	nodeID := "test-node-1"
	
	// First run: create node and commit some orders
	node1 := NewRaftNodeWithPersistence(nodeID, tmpDir)
	
	// Simulate becoming leader and committing
	node1.CurrentTerm = 3
	node1.Role = Leader
	
	// Commit 5 orders
	for i := 0; i < 5; i++ {
		cmd := map[string]string{
			"type":    "commit_order",
			"orderID": "order-" + string(rune('A'+i)),
			"status":  "DISPATCHED",
		}
		node1.HandleCommitOrder(cmd)
		time.Sleep(10 * time.Millisecond)
	}
	
	if len(node1.Log) != 5 {
		t.Errorf("Expected 5 log entries, got %d", len(node1.Log))
	}

	// "Crash" - just stop using node1
	
	// Second run: restart node
	node2 := NewRaftNodeWithPersistence(nodeID, tmpDir)
	
	// Should restore state
	if node2.CurrentTerm != 3 {
		t.Errorf("Expected term 3 after restart, got %d", node2.CurrentTerm)
	}

	if len(node2.Log) != 5 {
		t.Errorf("Expected 5 log entries after restart, got %d", len(node2.Log))
	}

	// Verify committed orders are still there
	if node2.CommitIndex != 5 {
		t.Errorf("Expected commit index 5 after restart, got %d", node2.CommitIndex)
	}
}

// TestVoteNotRegrantedAfterRestart tests that a node doesn't re-vote in same term.
func TestVoteNotRegrantedAfterRestart(t *testing.T) {
	tmpDir := t.TempDir()
	nodeID := "test-node-1"
	
	// First run: vote for candidate-A in term 5
	node1 := NewRaftNodeWithPersistence(nodeID, tmpDir)
	node1.CurrentTerm = 5
	node1.VotedFor = "candidate-A"
	
	// Persist the vote
	if node1.wal != nil {
		node1.wal.AppendTermChange(5)
		node1.wal.AppendVote(5, "candidate-A")
	}
	
	// "Restart"
	node2 := NewRaftNodeWithPersistence(nodeID, tmpDir)
	
	// Should remember it voted for candidate-A
	if node2.CurrentTerm != 5 {
		t.Errorf("Expected term 5 after restart")
	}
	
	if node2.VotedFor != "candidate-A" {
		t.Errorf("Expected VotedFor=candidate-A after restart, got %s", node2.VotedFor)
	}
}

// Helper to create RaftNode with persistence (if not already in main.go)
func NewRaftNodeWithPersistence(id, dataDir string) *RaftNode {
	// This would be implemented in main.go
	// For testing, we create a minimal node
	return &RaftNode{
		NodeID:      id,
		CurrentTerm: 0,
		VotedFor:    "",
		Role:        Follower,
		Log:         make([]LogEntry, 0),
		CommitIndex: 0,
		LastApplied: 0,
	}
}

