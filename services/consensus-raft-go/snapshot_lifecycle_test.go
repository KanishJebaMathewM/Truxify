package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOrderStatesIncludesSnapshotState(t *testing.T) {
	node := NewRaftNode("node1", nil, nil)
	node.snapshotIndex = 5
	node.snapshotTerm = 1
	node.snapshotState = map[string]string{
		"ord-1": "COMPLETED",
		"ord-2": "DISPATCHED",
	}
	node.Log = []LogEntry{
		{Index: 6, Term: 2, Command: "IN_TRANSIT", OrderID: "ord-2"},
	}

	node.mu.Lock()
	states := node.orderStatesLocked(uint64(len(node.Log)))
	node.mu.Unlock()

	if states["ord-1"] != "COMPLETED" {
		t.Fatalf("expected compacted state COMPLETED, got %q", states["ord-1"])
	}
	if states["ord-2"] != "IN_TRANSIT" {
		t.Fatalf("expected retained log to override snapshot state with IN_TRANSIT, got %q", states["ord-2"])
	}
}

func TestHandleCommitOrderRejectsTransitionFromCompactedState(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node := NewRaftNode("node1", nil, nil)
	node.mu.Lock()
	node.Role = Leader
	node.LeaderID = "node1"
	node.CurrentTerm = 2
	node.snapshotIndex = 5
	node.snapshotTerm = 1
	node.snapshotState = map[string]string{"ord-1": "COMPLETED"}
	node.CommitIndex = 5
	node.LastApplied = 5
	node.mu.Unlock()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(`{"order_id":"ord-1","command":"CREATED"}`))
	w := httptest.NewRecorder()
	node.HandleCommitOrder(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for transition from compacted COMPLETED state, got %d: %s", w.Code, w.Body.String())
	}
	node.mu.Lock()
	defer node.mu.Unlock()
	if len(node.Log) != 0 {
		t.Fatalf("expected compacted lifecycle state not to append a new entry, got %d entries", len(node.Log))
	}
}

func TestHandleCommitOrderDeduplicatesCompactedEntry(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node := NewRaftNode("node1", nil, nil)
	node.mu.Lock()
	node.Role = Leader
	node.LeaderID = "node1"
	node.CurrentTerm = 2
	node.snapshotIndex = 5
	node.snapshotTerm = 1
	node.snapshotState = map[string]string{"ord-1": "COMPLETED"}
	node.CommitIndex = 5
	node.LastApplied = 5
	node.mu.Unlock()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(`{"order_id":"ord-1","command":"COMPLETED"}`))
	w := httptest.NewRecorder()
	node.HandleCommitOrder(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for compacted duplicate, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response["success"] != true || response["already_committed"] != true {
		t.Fatalf("expected successful idempotent response, got %#v", response)
	}
	if response["raft_index"] != float64(5) || response["term"] != float64(1) || response["order_id"] != "ord-1" {
		t.Fatalf("unexpected compacted response: %#v", response)
	}

	node.mu.Lock()
	defer node.mu.Unlock()
	if len(node.Log) != 0 {
		t.Fatalf("expected no duplicate retained-log entry, got %d entries", len(node.Log))
	}
}
