package main

import (
	"net/http"
	"net/http/httptest"
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
