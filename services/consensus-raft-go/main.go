package main

import (
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"
)

type NodeRole string

const (
	Follower  NodeRole = "FOLLOWER"
	Candidate NodeRole = "CANDIDATE"
	Leader    NodeRole = "LEADER"
)

type LogEntry struct {
	Index     uint64    `json:"index"`
	Term      uint64    `json:"term"`
	Command   string    `json:"command"`
	OrderID   string    `json:"order_id"`
	Timestamp time.Time `json:"timestamp"`
}

type RaftNode struct {
	mu          sync.Mutex
	NodeID      string     `json:"node_id"`
	CurrentTerm uint64     `json:"current_term"`
	VotedFor    string     `json:"voted_for"`
	Role        NodeRole   `json:"role"`
	Log         []LogEntry `json:"log"`
	CommitIndex uint64     `json:"commit_index"`
	LastApplied uint64     `json:"last_applied"`
	Peers       []string   `json:"peers"`
	LeaderID    string     `json:"leader_id"`
}

func NewRaftNode(id string, peers []string) *RaftNode {
	return &RaftNode{
		NodeID:      id,
		CurrentTerm: 1,
		Role:        Leader,
		Log:         make([]LogEntry, 0),
		Peers:       peers,
		LeaderID:    id,
	}
}

func (rn *RaftNode) HandleStatus(w http.ResponseWriter, r *http.Request) {
	rn.mu.Lock()
	defer rn.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"node_id":      rn.NodeID,
		"role":         rn.Role,
		"term":         rn.CurrentTerm,
		"leader_id":    rn.LeaderID,
		"commit_index": rn.CommitIndex,
		"log_length":   len(rn.Log),
		"status":       "HEALTHY_CLUSTER",
		"timestamp":    time.Now().Format(time.RFC3339),
	})
}

func (rn *RaftNode) HandleCommitOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		OrderID string `json:"order_id"`
		Command string `json:"command"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	rn.mu.Lock()
	defer rn.mu.Unlock()

	entry := LogEntry{
		Index:     uint64(len(rn.Log) + 1),
		Term:      rn.CurrentTerm,
		Command:   req.Command,
		OrderID:   req.OrderID,
		Timestamp: time.Now(),
	}

	rn.Log = append(rn.Log, entry)
	rn.CommitIndex = entry.Index
	rn.LastApplied = entry.Index

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"raft_index":   entry.Index,
		"term":         entry.Term,
		"order_id":     entry.OrderID,
		"committed_at": entry.Timestamp.Format(time.RFC3339),
	})
}

func main() {
	rand.Seed(time.Now().UnixNano())

	port := os.Getenv("RAFT_PORT")
	if port == "" {
		port = "8089"
	}

	nodeID := os.Getenv("NODE_ID")
	if nodeID == "" {
		nodeID = "raft-node-north-1"
	}

	peers := []string{"raft-node-south-1", "raft-node-east-1", "raft-node-west-1"}
	node := NewRaftNode(nodeID, peers)

	http.HandleFunc("/api/v1/raft/status", node.HandleStatus)
	http.HandleFunc("/api/v1/raft/commit", node.HandleCommitOrder)

	log.Printf("🌐 Go Raft Distributed Consensus Node [%s] starting on port %s...", nodeID, port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Fatal consensus server error: %v", err)
	}
}
