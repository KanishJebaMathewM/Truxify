package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

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

// TestCommitDoesNotReturnSuccessWithoutQuorumReplication verifies the leader
// appends the entry locally but does not advance CommitIndex (and returns 503)
// when followers are unreachable for AppendEntries.
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

	// Seed matchIndex up to the current commit level (0) so the liveness
	// pre-check passes, while the peers themselves remain unreachable for
	// AppendEntries replication.
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
		t.Fatalf("expected 503 without quorum replication, got %d", resp.StatusCode)
	}

	node.mu.Lock()
	defer node.mu.Unlock()
	if len(node.Log) != 1 || node.Log[0].OrderID != "ord-lost-1" {
		t.Errorf("expected the entry appended to the local log, got %v", node.Log)
	}
	if node.CommitIndex != 0 || node.LastApplied != 0 {
		t.Errorf("expected commit_index/last_applied 0 without quorum, got commit=%d applied=%d",
			node.CommitIndex, node.LastApplied)
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

