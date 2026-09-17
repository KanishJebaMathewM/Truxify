package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleAppendRejectsUnknownLeader(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node := NewRaftNode("node1", []string{"node2", "node3"}, nil)
	node.CurrentTerm = 4
	node.Role = Follower
	node.LeaderID = "node2"
	node.VotedFor = "node2"

	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/append", strings.NewReader(`{"term":4,"leader_id":"intruder","prev_log_index":0,"prev_log_term":0,"entries":[],"leader_commit":0}`))
	rec := httptest.NewRecorder()

	node.HandleAppend(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for unknown leader, got %d", rec.Code)
	}
	if node.CurrentTerm != 4 {
		t.Fatalf("expected term to remain 4, got %d", node.CurrentTerm)
	}
	if node.Role != Follower {
		t.Fatalf("expected role to remain follower, got %s", node.Role)
	}
	if node.LeaderID != "node2" {
		t.Fatalf("expected leader ID to remain node2, got %q", node.LeaderID)
	}
	if node.VotedFor != "node2" {
		t.Fatalf("expected votedFor to remain node2, got %q", node.VotedFor)
	}
}

func TestHandleAppendRejectsHigherTermUnknownLeader(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node := NewRaftNode("node1", []string{"node2", "node3"}, nil)
	node.CurrentTerm = 4
	node.Role = Leader
	node.LeaderID = "node1"
	node.VotedFor = "node1"

	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/append", strings.NewReader(`{"term":9,"leader_id":"intruder","prev_log_index":0,"prev_log_term":0,"entries":[],"leader_commit":0}`))
	rec := httptest.NewRecorder()

	node.HandleAppend(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for unknown higher-term leader, got %d", rec.Code)
	}
	if node.CurrentTerm != 4 {
		t.Fatalf("expected higher-term request to be rejected before term update, got %d", node.CurrentTerm)
	}
	if node.Role != Leader {
		t.Fatalf("expected role to remain leader, got %s", node.Role)
	}
	if node.LeaderID != "node1" {
		t.Fatalf("expected leader ID to remain node1, got %q", node.LeaderID)
	}
	if node.VotedFor != "node1" {
		t.Fatalf("expected votedFor to remain node1, got %q", node.VotedFor)
	}
}

func TestHandleAppendAcceptsConfiguredLeader(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	node := NewRaftNode("node1", []string{"node2"}, nil)
	node.CurrentTerm = 4

	req := httptest.NewRequest(http.MethodPost, "/api/v1/raft/append", strings.NewReader(`{"term":4,"leader_id":"node2","prev_log_index":0,"prev_log_term":0,"entries":[],"leader_commit":0}`))
	rec := httptest.NewRecorder()

	node.HandleAppend(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for configured leader, got %d", rec.Code)
	}

	var response AppendEntriesResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Success {
		t.Fatalf("expected configured leader heartbeat to succeed")
	}
	if node.LeaderID != "node2" {
		t.Fatalf("expected leader ID node2, got %q", node.LeaderID)
	}
}
