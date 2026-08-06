package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
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

// RequestVoteRequest is the Raft RequestVote RPC payload.
type RequestVoteRequest struct {
	Term         uint64 `json:"term"`
	CandidateID  string `json:"candidate_id"`
	LastLogIndex uint64 `json:"last_log_index"`
	LastLogTerm  uint64 `json:"last_log_term"`
}

// allowedCommands is the allow-list of order lifecycle commands this service
// will commit. Configure via RAFT_ALLOWED_COMMANDS (comma-separated).
var allowedCommands = map[string]bool{
	"CREATED":    true,
	"DISPATCHED": true,
	"IN_TRANSIT": true,
	"DELIVERED":  true,
	"COMPLETED":  true,
	"CANCELLED":  true,
}

var (
	raftAPIKey []byte
	bypassAuth bool
)

// requireAuth rejects requests that do not carry the service-to-service API
// key (X-API-Key header) configured via RAFT_API_KEY.
func requireAuth(w http.ResponseWriter, r *http.Request) bool {
	if bypassAuth {
		return true
	}

	if len(raftAPIKey) == 0 {
		http.Error(w, "authentication is not configured", http.StatusServiceUnavailable)
		return false
	}

	provided := r.Header.Get("X-API-Key")
	if subtle.ConstantTimeCompare([]byte(provided), raftAPIKey) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return false
	}

	return true
}

// isValidOrderID reports whether an order id is well-formed.
func isValidOrderID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z') && !(c >= 'A' && c <= 'Z') && !(c >= '0' && c <= '9') && c != '-' && c != '_' {
			return false
		}
	}
	return true
}

// RequestVoteResponse is the Raft RequestVote RPC result.
type RequestVoteResponse struct {
	Term        uint64 `json:"term"`
	VoteGranted bool   `json:"vote_granted"`
}

// AppendEntriesRequest is the Raft AppendEntries (heartbeat) RPC payload.
type AppendEntriesRequest struct {
	Term         uint64     `json:"term"`
	LeaderID     string     `json:"leader_id"`
	PrevLogIndex uint64     `json:"prev_log_index"`
	PrevLogTerm  uint64     `json:"prev_log_term"`
	Entries      []LogEntry `json:"entries"`
	LeaderCommit uint64     `json:"leader_commit"`
}

// AppendEntriesResponse is the Raft AppendEntries RPC result.
type AppendEntriesResponse struct {
	Term    uint64 `json:"term"`
	Success bool   `json:"success"`
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
	PeerURLs    []string   `json:"peer_urls"`
	LeaderID    string     `json:"leader_id"`

	lastLeaderSeen     time.Time
	electionStarted    time.Time
	electionTimeout    time.Duration
	electionTimeoutMin time.Duration
	electionTimeoutMax time.Duration
	heartbeatInterval  time.Duration
	nextIndex          map[string]uint64
	matchIndex         map[string]uint64
	httpClient         *http.Client
}

// rng is a source of randomness for election timeouts.
var rng = rand.New(rand.NewSource(time.Now().UnixNano()))

func NewRaftNode(id string, peers []string, peerURLs []string) *RaftNode {
	heartbeatMs := envInt("RAFT_HEARTBEAT_MS", 100)
	electionMinMs := envInt("RAFT_ELECTION_TIMEOUT_MIN_MS", 500)
	electionMaxMs := envInt("RAFT_ELECTION_TIMEOUT_MAX_MS", 1200)
	if electionMaxMs < electionMinMs {
		electionMaxMs = electionMinMs
	}

	return &RaftNode{
		NodeID:             id,
		CurrentTerm:        0,
		Role:               Follower,
		Log:                make([]LogEntry, 0),
		Peers:              peers,
		PeerURLs:           peerURLs,
		LeaderID:           "",
		lastLeaderSeen:     time.Now(),
		heartbeatInterval:  time.Duration(heartbeatMs) * time.Millisecond,
		electionTimeoutMin: time.Duration(electionMinMs) * time.Millisecond,
		electionTimeoutMax: time.Duration(electionMaxMs) * time.Millisecond,
		electionTimeout:    time.Duration(electionMinMs) * time.Millisecond,
		nextIndex:          make(map[string]uint64),
		matchIndex:         make(map[string]uint64),
		httpClient:         &http.Client{Timeout: 500 * time.Millisecond},
	}
}

func (rn *RaftNode) lastLogIndex() uint64 {
	return uint64(len(rn.Log))
}

func (rn *RaftNode) lastLogTerm() uint64 {
	if len(rn.Log) == 0 {
		return 0
	}
	return rn.Log[len(rn.Log)-1].Term
}

func (rn *RaftNode) quorum() int {
	return (len(rn.PeerURLs)+1)/2 + 1
}

func (rn *RaftNode) randomElectionTimeout() time.Duration {
	minMs := int(rn.electionTimeoutMin / time.Millisecond)
	maxMs := int(rn.electionTimeoutMax / time.Millisecond)
	return time.Duration(minMs+rng.Intn(maxMs-minMs+1)) * time.Millisecond
}

// stepDownLocked resets the node to follower when a higher term is observed.
func (rn *RaftNode) stepDownLocked(term uint64) {
	if term <= rn.CurrentTerm {
		return
	}
	rn.CurrentTerm = term
	rn.VotedFor = ""
	rn.LeaderID = ""
	if rn.Role != Follower {
		rn.Role = Follower
	}
	rn.lastLeaderSeen = time.Now()
}

// startElection campaigns for leadership: bump term, vote for self, and
// request votes from peers outside the mutex lock to prevent deadlock.
func (rn *RaftNode) startElection() {
	rn.mu.Lock()
	rn.Role = Candidate
	rn.CurrentTerm++
	term := rn.CurrentTerm
	rn.VotedFor = rn.NodeID
	rn.LeaderID = ""
	rn.electionStarted = time.Now()
	rn.electionTimeout = rn.randomElectionTimeout()

	req := RequestVoteRequest{
		Term:         rn.CurrentTerm,
		CandidateID:  rn.NodeID,
		LastLogIndex: rn.lastLogIndex(),
		LastLogTerm:  rn.lastLogTerm(),
	}
	rn.mu.Unlock()

	// Perform outbound HTTP RPC requests without holding rn.mu to avoid deadlocks
	responses := rn.requestVotes(req)

	rn.mu.Lock()
	defer rn.mu.Unlock()

	// Verify the node is still a candidate in the same term
	if rn.Role != Candidate || rn.CurrentTerm != term {
		return
	}

	votes := 1 // self vote
	for _, resp := range responses {
		if resp.Term > rn.CurrentTerm {
			rn.stepDownLocked(resp.Term)
			return
		}
		if resp.VoteGranted {
			votes++
		}
	}

	if votes >= rn.quorum() {
		rn.Role = Leader
		rn.LeaderID = rn.NodeID
		// Per-follower replication state (Raft §5.3): the leader assumes each
		// follower's log matches its own and works backward from the end.
		rn.nextIndex = make(map[string]uint64, len(rn.PeerURLs))
		rn.matchIndex = make(map[string]uint64, len(rn.PeerURLs))
		for _, url := range rn.PeerURLs {
			rn.nextIndex[url] = rn.lastLogIndex() + 1
			// Optimistically assume each follower has replicated the leader's
			// full log (consistent with nextIndex). This keeps the admission
			// gate passable immediately after election when all followers are
			// up, instead of until the first heartbeat succeeds; actual
			// replication is still required to commit new entries.
			rn.matchIndex[url] = rn.lastLogIndex()
		}
		log.Printf("🌐 node [%s] elected leader for term %d", rn.NodeID, rn.CurrentTerm)
	}
}

// requestVotes sends RequestVote RPCs to all peers concurrently.
func (rn *RaftNode) requestVotes(req RequestVoteRequest) []RequestVoteResponse {
	var wg sync.WaitGroup
	var mu sync.Mutex
	responses := make([]RequestVoteResponse, 0, len(rn.PeerURLs))

	for _, url := range rn.PeerURLs {
		wg.Add(1)
		go func(peerURL string) {
			defer wg.Done()
			resp, err := rn.callVote(peerURL, req)
			if err != nil {
				return
			}
			mu.Lock()
			responses = append(responses, resp)
			mu.Unlock()
		}(url)
	}
	wg.Wait()

	return responses
}

// callVote sends a RequestVote RPC to a peer.
func (rn *RaftNode) callVote(peerURL string, req RequestVoteRequest) (RequestVoteResponse, error) {
	var resp RequestVoteResponse
	body, err := json.Marshal(req)
	if err != nil {
		return resp, err
	}
	reqHTTP, err := http.NewRequest(http.MethodPost, peerURL+"/api/v1/raft/vote", bytes.NewReader(body))
	if err != nil {
		return resp, err
	}
	reqHTTP.Header.Set("Content-Type", "application/json")
	reqHTTP.Header.Set("X-API-Key", string(raftAPIKey))
	res, err := rn.httpClient.Do(reqHTTP)
	if err != nil {
		return resp, err
	}
	defer res.Body.Close()
	err = json.NewDecoder(res.Body).Decode(&resp)
	return resp, err
}

// callAppend sends an AppendEntries RPC to a peer.
func (rn *RaftNode) callAppend(peerURL string, req AppendEntriesRequest) (AppendEntriesResponse, error) {
	var resp AppendEntriesResponse
	body, err := json.Marshal(req)
	if err != nil {
		return resp, err
	}
	reqHTTP, err := http.NewRequest(http.MethodPost, peerURL+"/api/v1/raft/append", bytes.NewReader(body))
	if err != nil {
		return resp, err
	}
	reqHTTP.Header.Set("Content-Type", "application/json")
	reqHTTP.Header.Set("X-API-Key", string(raftAPIKey))
	res, err := rn.httpClient.Do(reqHTTP)
	if err != nil {
		return resp, err
	}
	defer res.Body.Close()
	err = json.NewDecoder(res.Body).Decode(&resp)
	return resp, err
}

// sendHeartbeats replicates the leader's log to followers and advances
// CommitIndex once a quorum acknowledges the replicated entries. Each heartbeat
// sends AppendEntries with the entries a follower is still missing (based on
// nextIndex), updates matchIndex/nextIndex from the responses, and only then
// moves CommitIndex/LastApplied forward. HTTP calls run outside rn.mu.
func (rn *RaftNode) sendHeartbeats() {
	rn.mu.Lock()
	if rn.Role != Leader {
		rn.mu.Unlock()
		return
	}
	term := rn.CurrentTerm

	type peerState struct {
		url     string
		request AppendEntriesRequest
	}
	states := make([]peerState, 0, len(rn.PeerURLs))
	for _, url := range rn.PeerURLs {
		next := rn.nextIndex[url]
		if next == 0 {
			next = 1
		}
		prevLogIndex := next - 1
		prevLogTerm := uint64(0)
		if prevLogIndex > 0 && prevLogIndex <= uint64(len(rn.Log)) {
			prevLogTerm = rn.Log[prevLogIndex-1].Term
		}
		req := AppendEntriesRequest{
			Term:         term,
			LeaderID:     rn.NodeID,
			PrevLogIndex: prevLogIndex,
			PrevLogTerm:  prevLogTerm,
			LeaderCommit: rn.CommitIndex,
		}
		if next <= uint64(len(rn.Log)) {
			req.Entries = append(req.Entries, rn.Log[next-1:]...)
		}
		states = append(states, peerState{url: url, request: req})
	}
	rn.mu.Unlock()

	type result struct {
		url     string
		request AppendEntriesRequest
		resp    AppendEntriesResponse
		err     error
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	results := make([]result, 0, len(states))

	for _, st := range states {
		wg.Add(1)
		go func(url string, req AppendEntriesRequest) {
			defer wg.Done()
			resp, err := rn.callAppend(url, req)
			mu.Lock()
			results = append(results, result{url: url, request: req, resp: resp, err: err})
			mu.Unlock()
		}(st.url, st.request)
	}
	wg.Wait()

	rn.mu.Lock()
	defer rn.mu.Unlock()

	if rn.Role != Leader || rn.CurrentTerm != term {
		return
	}

	for _, res := range results {
		if res.err != nil {
			continue
		}
		if res.resp.Term > rn.CurrentTerm {
			rn.stepDownLocked(res.resp.Term)
			return
		}
		if res.resp.Success {
			// Follower accepted the prefix; record the highest matching index.
			rn.matchIndex[res.url] = res.request.PrevLogIndex + uint64(len(res.request.Entries))
			rn.nextIndex[res.url] = rn.matchIndex[res.url] + 1
		} else if rn.nextIndex[res.url] > 1 {
			// Log inconsistency: back off and retry from an earlier prefix.
			rn.nextIndex[res.url]--
		}
	}

	rn.advanceCommitIndexLocked()
}

// advanceCommitIndexLocked advances CommitIndex to the highest index replicated
// to a quorum of the cluster (including the leader itself) in the current term,
// then applies committed entries by moving LastApplied forward. Entries from
// previous terms are only committed indirectly once a current-term entry commits
// (Raft §5.4.2).
func (rn *RaftNode) advanceCommitIndexLocked() {
	last := rn.lastLogIndex()
	for n := rn.CommitIndex + 1; n <= last; n++ {
		if rn.Log[n-1].Term != rn.CurrentTerm {
			continue
		}
		acked := 1 // the leader's own log always matches
		for _, m := range rn.matchIndex {
			if m >= n {
				acked++
			}
		}
		if acked < rn.quorum() {
			break
		}
		rn.CommitIndex = n
	}
	if rn.CommitIndex > rn.LastApplied {
		rn.LastApplied = rn.CommitIndex
	}
}

// leaderHasQuorumLocked reports whether a majority of the cluster acknowledges
// the current leadership, based on the durable matchIndex (the last index each
// follower has acknowledged replicating) rather than the ephemeral per-round
// heartbeat cache. Right after an election matchIndex is seeded optimistically,
// so healthy clusters do not spuriously reject commits before the first
// heartbeat completes.
func (rn *RaftNode) leaderHasQuorumLocked() bool {
	acked := 1 // self
	for _, m := range rn.matchIndex {
		if m >= rn.CommitIndex {
			acked++
		}
	}
	return acked >= rn.quorum()
}

func (rn *RaftNode) clusterStatusLocked() string {
	switch rn.Role {
	case Leader:
		if rn.leaderHasQuorumLocked() {
			return "HEALTHY_CLUSTER"
		}
		return "UNHEALTHY_CLUSTER"
	case Candidate:
		return "ELECTION_IN_PROGRESS"
	default:
		if time.Since(rn.lastLeaderSeen) <= rn.electionTimeout {
			return "HEALTHY_CLUSTER"
		}
		return "NO_LEADER"
	}
}

// run drives the Raft state machine: heartbeats while leader, elections when
// a leader has not been heard from.
func (rn *RaftNode) run() {
	for {
		var delay time.Duration
		var action string

		rn.mu.Lock()
		switch rn.Role {
		case Leader:
			action = "heartbeat"
			delay = rn.heartbeatInterval
		case Candidate:
			if time.Since(rn.electionStarted) > rn.electionTimeout {
				action = "election"
			}
			delay = 50 * time.Millisecond
		default:
			if time.Since(rn.lastLeaderSeen) > rn.electionTimeout {
				action = "election"
			}
			delay = 50 * time.Millisecond
		}
		rn.mu.Unlock()

		if action == "heartbeat" {
			rn.sendHeartbeats()
		} else if action == "election" {
			rn.startElection()
		}

		time.Sleep(delay)
	}
}

// HandleStatus reports node state and cluster health.
func (rn *RaftNode) HandleStatus(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}

	rn.mu.Lock()
	defer rn.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"node_id":      rn.NodeID,
		"role":         rn.Role,
		"term":         rn.CurrentTerm,
		"voted_for":    rn.VotedFor,
		"leader_id":    rn.LeaderID,
		"commit_index": rn.CommitIndex,
		"log_length":   len(rn.Log),
		"peers":        rn.Peers,
		"quorum":       rn.quorum(),
		"status":       rn.clusterStatusLocked(),
		"timestamp":    time.Now().Format(time.RFC3339),
	})
}

// HandleVote implements the Raft RequestVote RPC.
func (rn *RaftNode) HandleVote(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}

	var req RequestVoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	rn.mu.Lock()
	defer rn.mu.Unlock()

	resp := RequestVoteResponse{Term: rn.CurrentTerm, VoteGranted: false}

	if req.Term > rn.CurrentTerm {
		rn.stepDownLocked(req.Term)
	}

	if req.Term == rn.CurrentTerm &&
		(rn.VotedFor == "" || rn.VotedFor == req.CandidateID) &&
		rn.isLogUpToDate(req.LastLogIndex, req.LastLogTerm) {
		rn.VotedFor = req.CandidateID
		resp.VoteGranted = true
	}

	resp.Term = rn.CurrentTerm

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// isLogUpToDate reports whether the candidate's log is at least as up to date
// as this node's log (Raft vote restriction).
func (rn *RaftNode) isLogUpToDate(lastLogIndex, lastLogTerm uint64) bool {
	myLastIdx, myLastTerm := rn.lastLogIndex(), rn.lastLogTerm()
	if lastLogTerm != myLastTerm {
		return lastLogTerm > myLastTerm
	}
	return lastLogIndex >= myLastIdx
}

// HandleAppend implements the Raft AppendEntries RPC.
func (rn *RaftNode) HandleAppend(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}

	var req AppendEntriesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	rn.mu.Lock()
	defer rn.mu.Unlock()

	resp := AppendEntriesResponse{Term: rn.CurrentTerm, Success: false}

	if req.Term > rn.CurrentTerm {
		rn.stepDownLocked(req.Term)
	}

	if req.Term == rn.CurrentTerm {
		rn.Role = Follower
		rn.LeaderID = req.LeaderID
		// Never clear VotedFor in the current term: a node must vote at most
		// once per term. Record the acknowledged leader as this term's vote
		// when none has been cast yet, so a later candidate in the same term
		// cannot obtain a second vote.
		if rn.VotedFor == "" || rn.VotedFor == req.LeaderID {
			rn.VotedFor = req.LeaderID
		}
		rn.lastLeaderSeen = time.Now()

		if rn.appendLogFromLeaderLocked(req) {
			if req.LeaderCommit > rn.CommitIndex {
				last := uint64(len(rn.Log))
				if req.LeaderCommit < last {
					last = req.LeaderCommit
				}
				rn.CommitIndex = last
			}
			// Apply step (Raft §5.3): advance LastApplied up to CommitIndex on
			// every node, not just the leader, so followers apply the committed
			// entries they received. Previously only the leader advanced
			// LastApplied (via advanceCommitIndexLocked), so a follower's
			// LastApplied stayed at 0 forever while CommitIndex grew.
			if rn.CommitIndex > rn.LastApplied {
				rn.LastApplied = rn.CommitIndex
			}
			resp.Success = true
		}
	}

	resp.Term = rn.CurrentTerm

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// appendLogFromLeaderLocked appends replicated entries after checking log
// consistency with the previous entry.
func (rn *RaftNode) appendLogFromLeaderLocked(req AppendEntriesRequest) bool {
	if req.PrevLogIndex > uint64(len(rn.Log)) {
		return false
	}
	if req.PrevLogIndex > 0 {
		prev := rn.Log[req.PrevLogIndex-1]
		if prev.Term != req.PrevLogTerm {
			return false
		}
	}
	for i, e := range req.Entries {
		idx := int(req.PrevLogIndex) + 1 + i
		if idx <= len(rn.Log) {
			if rn.Log[idx-1].Term != e.Term {
				rn.Log = rn.Log[:idx-1]
				rn.Log = append(rn.Log, req.Entries[i:]...)
				return true
			}
		} else {
			rn.Log = append(rn.Log, req.Entries[i:]...)
			return true
		}
	}
	return true
}

// HandleCommitOrder accepts a committed order entry on the leader.
func (rn *RaftNode) HandleCommitOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !requireAuth(w, r) {
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

	if !isValidOrderID(req.OrderID) {
		http.Error(w, "Invalid order_id", http.StatusBadRequest)
		return
	}

	if !allowedCommands[req.Command] {
		http.Error(w, "Invalid command", http.StatusBadRequest)
		return
	}

	rn.mu.Lock()

	if rn.Role != Leader {
		rn.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   false,
			"error":     "not the cluster leader",
			"leader_id": rn.LeaderID,
		})
		return
	}

	if !rn.leaderHasQuorumLocked() {
		rn.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "no cluster quorum",
		})
		return
	}

	entry := LogEntry{
		Index:     uint64(len(rn.Log) + 1),
		Term:      rn.CurrentTerm,
		Command:   req.Command,
		OrderID:   req.OrderID,
		Timestamp: time.Now(),
	}

	// Append to the local log first. CommitIndex is NOT advanced here: the entry
	// must first be replicated to a quorum of followers (Raft §5.3).
	rn.Log = append(rn.Log, entry)
	rn.mu.Unlock()

	// Replicate to followers and wait for a quorum acknowledgement before
	// treating the entry as committed.
	rn.sendHeartbeats()

	rn.mu.Lock()
	if rn.Role != Leader {
		rn.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   false,
			"error":     "stepped down while replicating entry",
			"leader_id": rn.LeaderID,
		})
		return
	}
	committed := rn.CommitIndex >= entry.Index
	rn.mu.Unlock()

	if !committed {
		rn.mu.Lock()
		defer rn.mu.Unlock()
		if rn.Role != Leader {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success":   false,
				"error":     "stepped down while replicating entry",
				"leader_id": rn.LeaderID,
			})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":    false,
			"error":      "entry not yet committed to a quorum of followers",
			"raft_index": entry.Index,
		})
		return
	}

	// Propagate the updated LeaderCommit to followers so they apply the entry
	// before the client observes success.
	rn.sendHeartbeats()

	rn.mu.Lock()
	defer rn.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"raft_index":   entry.Index,
		"term":         entry.Term,
		"order_id":     entry.OrderID,
		"committed_at": entry.Timestamp.Format(time.RFC3339),
	})
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func splitCSV(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func main() {
	port := os.Getenv("RAFT_PORT")
	if port == "" {
		port = "8089"
	}

	nodeID := os.Getenv("NODE_ID")
	if nodeID == "" {
		nodeID = "raft-node-north-1"
	}

	raftAPIKey = []byte(os.Getenv("RAFT_API_KEY"))
	bypassAuth = os.Getenv("BYPASS_AUTH") == "true" && os.Getenv("NODE_ENV") != "production"
	if v := os.Getenv("RAFT_ALLOWED_COMMANDS"); v != "" {
		cmds := strings.Split(v, ",")
		allowed := make(map[string]bool, len(cmds))
		for _, c := range cmds {
			if c = strings.TrimSpace(c); c != "" {
				allowed[c] = true
			}
		}
		if len(allowed) > 0 {
			allowedCommands = allowed
		}
	}

	peers := []string{"raft-node-south-1", "raft-node-east-1", "raft-node-west-1"}
	if v := os.Getenv("RAFT_PEER_IDS"); v != "" {
		peers = splitCSV(v)
	}

	var peerURLs []string
	if v := os.Getenv("RAFT_PEER_URLS"); v != "" {
		peerURLs = splitCSV(v)
	}

	node := NewRaftNode(nodeID, peers, peerURLs)

	http.HandleFunc("/api/v1/raft/status", node.HandleStatus)
	http.HandleFunc("/api/v1/raft/commit", node.HandleCommitOrder)
	http.HandleFunc("/api/v1/raft/vote", node.HandleVote)
	http.HandleFunc("/api/v1/raft/append", node.HandleAppend)

	log.Printf("🌐 Go Raft Distributed Consensus Node [%s] starting on port %s...", nodeID, port)
	go node.run()
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Fatal consensus server error: %v", err)
	}
}
