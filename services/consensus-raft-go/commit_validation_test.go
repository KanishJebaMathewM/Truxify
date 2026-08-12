package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// commitOrder posts an order lifecycle command to the node and returns the HTTP
// status code and decoded payload.
func commitOrder(t *testing.T, n *RaftNode, orderID, command string) (int, map[string]interface{}) {
	t.Helper()
	body := fmt.Sprintf(`{"order_id":%q,"command":%q}`, orderID, command)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/commit", strings.NewReader(body))
	w := httptest.NewRecorder()
	n.HandleCommitOrder(w, req)
	var payload map[string]interface{}
	json.NewDecoder(w.Body).Decode(&payload)
	return w.Code, payload
}

// newTestLeader returns a single-node leader so every committed entry is
// immediately committed locally (quorum of 1).
func newTestLeader() *RaftNode {
	n := NewRaftNode("node1", nil, nil)
	n.mu.Lock()
	n.Role = Leader
	n.LeaderID = "node1"
	n.CurrentTerm = 1
	n.mu.Unlock()
	return n
}

// TestCanTransition verifies the order state machine rules directly.
func TestCanTransition(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{"", "CREATED", true},
		{"", "DISPATCHED", false},
		{"", "CANCELLED", false},
		{"CREATED", "CREATED", false},
		{"CREATED", "DISPATCHED", true},
		{"CREATED", "IN_TRANSIT", false},
		{"CREATED", "CANCELLED", true},
		{"CREATED", "COMPLETED", false},
		{"CREATED", "DELIVERED", false},
		{"DISPATCHED", "IN_TRANSIT", true},
		{"DISPATCHED", "DELIVERED", false},
		{"DISPATCHED", "CANCELLED", true},
		{"DISPATCHED", "CREATED", false},
		{"IN_TRANSIT", "DELIVERED", true},
		{"IN_TRANSIT", "CANCELLED", true},
		{"DELIVERED", "CANCELLED", false},
		{"DELIVERED", "COMPLETED", true},
		{"DELIVERED", "IN_TRANSIT", false},
		{"COMPLETED", "CANCELLED", false},
		{"COMPLETED", "COMPLETED", false},
		{"CANCELLED", "COMPLETED", false},
		{"CANCELLED", "CREATED", false},
	}
	for _, c := range cases {
		if got := canTransition(c.from, c.to); got != c.want {
			t.Errorf("canTransition(%q, %q) = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}

// TestHandleCommitOrderRejectsInvalidTransitions verifies /commit rejects
// commands that do not follow the order's lifecycle history.
func TestHandleCommitOrderRejectsInvalidTransitions(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	n := newTestLeader()

	// DISPATCHED before CREATED is invalid.
	if code, _ := commitOrder(t, n, "ord-trans-1", "DISPATCHED"); code != http.StatusBadRequest {
		t.Errorf("expected 400 for DISPATCHED before CREATED, got %d", code)
	}

	if code, _ := commitOrder(t, n, "ord-trans-1", "CREATED"); code != http.StatusOK {
		t.Fatalf("expected 200 for CREATED, got %d", code)
	}

	// DELIVERED before DISPATCHED is invalid (strict chain).
	if code, _ := commitOrder(t, n, "ord-trans-1", "DELIVERED"); code != http.StatusBadRequest {
		t.Errorf("expected 400 for DELIVERED before DISPATCHED, got %d", code)
	}

	if code, _ := commitOrder(t, n, "ord-trans-1", "DISPATCHED"); code != http.StatusOK {
		t.Fatalf("expected 200 for DISPATCHED, got %d", code)
	}

	if code, _ := commitOrder(t, n, "ord-trans-1", "IN_TRANSIT"); code != http.StatusOK {
		t.Fatalf("expected 200 for IN_TRANSIT, got %d", code)
	}

	if code, _ := commitOrder(t, n, "ord-trans-1", "DELIVERED"); code != http.StatusOK {
		t.Fatalf("expected 200 for DELIVERED after IN_TRANSIT, got %d", code)
	}

	// CANCELLED from DELIVERED is invalid (only CREATED/DISPATCHED/IN_TRANSIT).
	if code, _ := commitOrder(t, n, "ord-trans-1", "CANCELLED"); code != http.StatusBadRequest {
		t.Errorf("expected 400 for CANCELLED after DELIVERED, got %d", code)
	}

	// Re-submitting the earlier DELIVERED is a duplicate, answered idempotently.
	_, dup := commitOrder(t, n, "ord-trans-1", "DELIVERED")
	if idx, ok := dup["raft_index"].(float64); !ok || idx != 4 {
		t.Errorf("expected duplicate DELIVERED to report raft_index 4, got %v", dup["raft_index"])
	}

	n.mu.Lock()
	logLen := len(n.Log)
	n.mu.Unlock()
	if logLen != 4 {
		t.Errorf("expected log of 4 entries, got %d", logLen)
	}
}

// TestHandleCommitOrderIdempotentDuplicate verifies the same (order_id,
// command) submission returns the existing entry's index without appending.
func TestHandleCommitOrderIdempotentDuplicate(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	n := newTestLeader()

	code, first := commitOrder(t, n, "ord-dup-1", "CREATED")
	if code != http.StatusOK {
		t.Fatalf("expected 200 for first CREATED, got %d", code)
	}
	firstIndex := first["raft_index"].(float64)

	// Re-submitting the identical command must not append a second entry.
	code, second := commitOrder(t, n, "ord-dup-1", "CREATED")
	if code != http.StatusOK {
		t.Fatalf("expected 200 for duplicate CREATED, got %d", code)
	}
	secondIndex := second["raft_index"].(float64)
	if secondIndex != firstIndex {
		t.Errorf("expected duplicate to return raft_index %v, got %v", firstIndex, secondIndex)
	}

	n.mu.Lock()
	logLen := len(n.Log)
	n.mu.Unlock()
	if logLen != 1 {
		t.Errorf("expected log to stay at 1 entry for duplicate submission, got %d", logLen)
	}
}

// TestHandleCommitOrderRejectsCommandAfterCompletion verifies a fully completed
// order cannot be transitioned further.
func TestHandleCommitOrderRejectsCommandAfterCompletion(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	n := newTestLeader()

	for _, cmd := range []string{"CREATED", "DISPATCHED", "IN_TRANSIT", "DELIVERED", "COMPLETED"} {
		if code, _ := commitOrder(t, n, "ord-complete-1", cmd); code != http.StatusOK {
			t.Fatalf("expected 200 for %s, got %d", cmd, code)
		}
	}

	// CANCELLED after COMPLETED is a fresh command rejected as terminal.
	if code, _ := commitOrder(t, n, "ord-complete-1", "CANCELLED"); code != http.StatusBadRequest {
		t.Errorf("expected 400 for CANCELLED after COMPLETED, got %d", code)
	}
	// A duplicate of an already-committed command stays idempotent.
	_, dup := commitOrder(t, n, "ord-complete-1", "DELIVERED")
	if idx, ok := dup["raft_index"].(float64); !ok || idx != 4 {
		t.Errorf("expected duplicate DELIVERED to report raft_index 4, got %v", dup["raft_index"])
	}

	// Same for a cancelled order: a fresh command after CANCELLED is rejected.
	n2 := newTestLeader()
	for _, cmd := range []string{"CREATED", "DISPATCHED", "CANCELLED"} {
		if code, _ := commitOrder(t, n2, "ord-cancel-1", cmd); code != http.StatusOK {
			t.Fatalf("expected 200 for %s, got %d", cmd, code)
		}
	}
	if code, _ := commitOrder(t, n2, "ord-cancel-1", "IN_TRANSIT"); code != http.StatusBadRequest {
		t.Errorf("expected 400 for IN_TRANSIT after CANCELLED, got %d", code)
	}
}

// TestHandleCommitOrderStateIsolation verifies the per-order state machine is
// independent between orders.
func TestHandleCommitOrderStateIsolation(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	n := newTestLeader()

	if code, _ := commitOrder(t, n, "ord-a", "CREATED"); code != http.StatusOK {
		t.Fatalf("expected 200 for ord-a CREATED, got %d", code)
	}
	if code, _ := commitOrder(t, n, "ord-b", "CREATED"); code != http.StatusOK {
		t.Fatalf("expected 200 for ord-b CREATED, got %d", code)
	}
	// ord-a may move forward even though ord-b is still CREATED.
	if code, _ := commitOrder(t, n, "ord-a", "DISPATCHED"); code != http.StatusOK {
		t.Fatalf("expected 200 for ord-a DISPATCHED, got %d", code)
	}
	if code, _ := commitOrder(t, n, "ord-a", "IN_TRANSIT"); code != http.StatusOK {
		t.Fatalf("expected 200 for ord-a IN_TRANSIT, got %d", code)
	}
	if code, _ := commitOrder(t, n, "ord-a", "DELIVERED"); code != http.StatusOK {
		t.Fatalf("expected 200 for ord-a DELIVERED, got %d", code)
	}

	// ord-b is still at CREATED: DISPATCHED is valid, DELIVERED is not (it
	// requires IN_TRANSIT), proving the per-order machine stays isolated.
	if code, _ := commitOrder(t, n, "ord-b", "DISPATCHED"); code != http.StatusOK {
		t.Fatalf("expected 200 for ord-b DISPATCHED, got %d", code)
	}
	if code, _ := commitOrder(t, n, "ord-b", "DELIVERED"); code != http.StatusBadRequest {
		t.Errorf("expected 400 for ord-b DELIVERED before IN_TRANSIT, got %d", code)
	}
}
