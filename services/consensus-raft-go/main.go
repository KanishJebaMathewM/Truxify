package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
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

// maxRequestBodyBytes caps request bodies decoded by this service (1 MiB) so
// an oversized or streamed body cannot be buffered into memory.
const maxRequestBodyBytes = 1 << 20

// decodeJSONBody decodes r.Body into v with a 1 MiB cap. It writes a 413 and
// returns false when the body exceeds the cap; the net/http server drains and
// closes the connection afterwards so it is not left in an unsafe state.
func decodeJSONBody(w http.ResponseWriter, r *http.Request, v interface{}) bool {
	if r.ContentLength > maxRequestBodyBytes {
		http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return false
		}
		http.Error(w, "Invalid payload", http.StatusBadRequest)
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
	// liveAck records which peers have acknowledged at least one successful
	// AppendEntries round in the current leadership term. It is reset whenever
	// a new leader is elected and drives the /commit admission gate so a leader
	// never accepts new entries without evidence of a reachable quorum. A peer
	// is also dropped from liveAck whenever a heartbeat fails or is rejected, so
	// liveness reflects recent contact instead of a once-set flag.
	liveAck    map[string]bool
	persister  *persister
	httpClient *http.Client
	// rng is this node's own source of randomness for election timeouts. It is
	// only accessed while holding mu, so a per-node Rand is safe for concurrent
	// use across election goroutines of different nodes.
	rng *rand.Rand

	wal                 *os.File
	storePath           string
	walPath             string
	persistedIndex      uint64
	snapshotIndex       uint64
	snapshotTerm        uint64
	snapshotState       map[string]string
	snapshotPath        string
	compactionThreshold uint64
}

// persister durably stores the Raft stable state (currentTerm, votedFor, and
// the log) so a restarted node does not lose committed entries or re-vote in a
// term it already voted in (Raft §5.1 / §5.4.2). State is written atomically to
// a JSON file on every mutation ("persist then respond"): SaveState is called
// when the term or vote changes, and SaveLog when the log changes. load() is
// invoked at startup so CurrentTerm/VotedFor/Log survive restarts.
type persister struct {
	path     string
	mu       sync.Mutex
	term     uint64
	votedFor string
	log      []LogEntry
}

func newPersister(id string) *persister {
	if f := os.Getenv("RAFT_STATE_FILE"); f != "" {
		if f == "none" {
			return &persister{path: ""}
		}
		return &persister{path: f}
	}
	dir := os.Getenv("RAFT_STATE_DIR")
	if dir == "" || dir == "none" {
		return &persister{path: ""}
	}
	_ = os.MkdirAll(dir, 0o755)
	return &persister{path: filepath.Join(dir, "raft-state-"+id+".json")}
}

// load reads the persisted snapshot. It returns zero values if no state file
// exists or it is unreadable, so a first boot starts from a clean slate.
func (p *persister) load() (uint64, string, []LogEntry) {
	if p == nil || p.path == "" {
		return 0, "", nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	data, err := os.ReadFile(p.path)
	if err != nil {
		return 0, "", nil
	}
	var s struct {
		Term     uint64     `json:"current_term"`
		VotedFor string     `json:"voted_for"`
		Log      []LogEntry `json:"log"`
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return 0, "", nil
	}
	p.term = s.Term
	p.votedFor = s.VotedFor
	p.log = s.Log
	return s.Term, s.VotedFor, s.Log
}

func (p *persister) write() error {
	if p == nil || p.path == "" {
		return nil
	}
	s := struct {
		Term     uint64     `json:"current_term"`
		VotedFor string     `json:"voted_for"`
		Log      []LogEntry `json:"log"`
	}{p.term, p.votedFor, p.log}
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	tmp := p.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p.path)
}

// SaveState persists the current term and the candidate this node voted for.
func (p *persister) SaveState(term uint64, votedFor string) error {
	if p == nil || p.path == "" {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.term = term
	p.votedFor = votedFor
	return p.write()
}

// SaveLog persists the full replicated log after it is mutated.
func (p *persister) SaveLog(log []LogEntry) error {
	if p == nil || p.path == "" {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.log = make([]LogEntry, len(log))
	copy(p.log, log)
	return p.write()
}

func NewRaftNode(id string, peers []string, peerURLs []string) *RaftNode {
	heartbeatMs := envInt("RAFT_HEARTBEAT_MS", 100)
	electionMinMs := envInt("RAFT_ELECTION_TIMEOUT_MIN_MS", 500)
	electionMaxMs := envInt("RAFT_ELECTION_TIMEOUT_MAX_MS", 1200)
	if electionMaxMs < electionMinMs {
		electionMaxMs = electionMinMs
	}

	p := newPersister(id)
	term, votedFor, log := p.load()

	return &RaftNode{
		NodeID:              id,
		CurrentTerm:         term,
		VotedFor:            votedFor,
		Role:                Follower,
		Log:                 log,
		persister:           p,
		Peers:               peers,
		PeerURLs:            peerURLs,
		LeaderID:            "",
		lastLeaderSeen:      time.Now(),
		heartbeatInterval:   time.Duration(heartbeatMs) * time.Millisecond,
		electionTimeoutMin: time.Duration(electionMinMs) * time.Millisecond,
		electionTimeoutMax: time.Duration(electionMaxMs) * time.Millisecond,
		electionTimeout:    time.Duration(electionMinMs) * time.Millisecond,
		nextIndex:           make(map[string]uint64),
		matchIndex:          make(map[string]uint64),
		liveAck:             make(map[string]bool),
		walPath:             defaultWALPath(),
		compactionThreshold: uint64(envInt("RAFT_COMPACTION_THRESHOLD", 1000)),
		httpClient:          &http.Client{Timeout: 500 * time.Millisecond},
		rng:                 rand.New(rand.NewSource(rand.Int63())),
	}
}

// logIndex maps a canonical 1-based log index to its 0-based slice index in rn.Log.
func (rn *RaftNode) logIndex(index uint64) int {
	return int(index - rn.snapshotIndex - 1)
}

func (rn *RaftNode) lastLogIndex() uint64 {
	return rn.snapshotIndex + uint64(len(rn.Log))
}

func (rn *RaftNode) lastLogTerm() uint64 {
	if len(rn.Log) == 0 {
		return rn.snapshotTerm
	}
	return rn.Log[len(rn.Log)-1].Term
}

func (rn *RaftNode) quorum() int {
	return (len(rn.PeerURLs)+1)/2 + 1
}

func (rn *RaftNode) randomElectionTimeout() time.Duration {
	minMs := int(rn.electionTimeoutMin / time.Millisecond)
	maxMs := int(rn.electionTimeoutMax / time.Millisecond)
	return time.Duration(minMs+rn.rng.Intn(maxMs-minMs+1)) * time.Millisecond
}

// stepDownLocked resets the node to follower when a higher term is observed.
func (rn *RaftNode) stepDownLocked(term uint64) {
	if term <= rn.CurrentTerm {
		return
	}
	rn.CurrentTerm = term
	rn.VotedFor = ""
	if err := rn.persister.SaveState(rn.CurrentTerm, rn.VotedFor); err != nil {
		log.Printf("raft persist error: %v", err)
	}
	rn.LeaderID = ""
	if rn.Role != Follower {
		rn.Role = Follower
	}
	rn.lastLeaderSeen = time.Now()
	if err := rn.persistTermLocked(term, ""); err != nil {
		log.Printf("⚠️ node [%s] failed to persist term %d: %v", rn.NodeID, term, err)
	}
}

// startElection campaigns for leadership: bump term, vote for self, and
// request votes from peers outside the mutex lock to prevent deadlock.
func (rn *RaftNode) startElection() {
	rn.mu.Lock()
	rn.Role = Candidate
	rn.CurrentTerm++
	term := rn.CurrentTerm
	rn.VotedFor = rn.NodeID
	if err := rn.persister.SaveState(rn.CurrentTerm, rn.VotedFor); err != nil {
		log.Printf("raft persist error: %v", err)
	}
	rn.LeaderID = ""
	rn.electionStarted = time.Now()
	rn.electionTimeout = rn.randomElectionTimeout()

	if err := rn.persistTermLocked(term, rn.VotedFor); err != nil {
		rn.Role = Follower
		rn.VotedFor = ""
		rn.CurrentTerm--
		log.Printf("⚠️ node [%s] failed to persist election state for term %d: %v", rn.NodeID, term, err)
		rn.mu.Unlock()
		return
	}

	req := RequestVoteRequest{
		Term:         rn.CurrentTerm,
		CandidateID:  rn.NodeID,
		LastLogIndex: rn.lastLogIndex(),
		LastLogTerm:  rn.lastLogTerm(),
	}
	rn.persistMeta()
	rn.mu.Unlock()

	responses := rn.requestVotes(req)

	rn.mu.Lock()
	defer rn.mu.Unlock()

	if rn.Role != Candidate || rn.CurrentTerm != term {
		return
	}

	votes := 1
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
		rn.nextIndex = make(map[string]uint64, len(rn.PeerURLs))
		rn.matchIndex = make(map[string]uint64, len(rn.PeerURLs))
		rn.liveAck = make(map[string]bool, len(rn.PeerURLs))
		for _, url := range rn.PeerURLs {
			rn.nextIndex[url] = rn.lastLogIndex() + 1
			rn.matchIndex[url] = 0
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

// callSnapshot sends an InstallSnapshot RPC to a peer.
func (rn *RaftNode) callSnapshot(peerURL string, req InstallSnapshotRequest) (InstallSnapshotResponse, error) {
	var resp InstallSnapshotResponse
	body, err := json.Marshal(req)
	if err != nil {
		return resp, err
	}
	reqHTTP, err := http.NewRequest(http.MethodPost, peerURL+"/api/v1/raft/snapshot", bytes.NewReader(body))
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
		url      string
		request  AppendEntriesRequest
		snapshot *InstallSnapshotRequest
	}
	states := make([]peerState, 0, len(rn.PeerURLs))
	for _, url := range rn.PeerURLs {
		next := rn.nextIndex[url]
		if next == 0 {
			next = rn.snapshotIndex + 1
		}
		if next <= rn.snapshotIndex {
			snap := &InstallSnapshotRequest{
				Term:          term,
				LeaderID:      rn.NodeID,
				SnapshotIndex: rn.snapshotIndex,
				SnapshotTerm:  rn.snapshotTerm,
				State:         rn.snapshotState,
			}
			states = append(states, peerState{url: url, snapshot: snap})
			continue
		}
		prevLogIndex := next - 1
		prevLogTerm := rn.snapshotTerm
		if prevLogIndex > rn.snapshotIndex {
			prevLogTerm = rn.Log[rn.logIndex(prevLogIndex)].Term
		}
		req := AppendEntriesRequest{
			Term:         term,
			LeaderID:     rn.NodeID,
			PrevLogIndex: prevLogIndex,
			PrevLogTerm:  prevLogTerm,
			LeaderCommit: rn.CommitIndex,
		}
		if next <= rn.lastLogIndex() {
			req.Entries = append(req.Entries, rn.Log[rn.logIndex(next):]...)
		}
		states = append(states, peerState{url: url, request: req})
	}
	rn.mu.Unlock()

	type result struct {
		url      string
		request  AppendEntriesRequest
		snapshot *InstallSnapshotRequest
		resp     AppendEntriesResponse
		snapResp InstallSnapshotResponse
		err      error
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	results := make([]result, 0, len(states))

	for _, st := range states {
		wg.Add(1)
		go func(url string, req AppendEntriesRequest, snap *InstallSnapshotRequest) {
			defer wg.Done()
			if snap != nil {
				resp, err := rn.callSnapshot(url, *snap)
				mu.Lock()
				results = append(results, result{url: url, snapshot: snap, snapResp: resp, err: err})
				mu.Unlock()
				return
			}
			resp, err := rn.callAppend(url, req)
			mu.Lock()
			results = append(results, result{url: url, request: req, resp: resp, err: err})
			mu.Unlock()
		}(st.url, st.request, st.snapshot)
	}
	wg.Wait()

	rn.mu.Lock()
	defer rn.mu.Unlock()

	if rn.Role != Leader || rn.CurrentTerm != term {
		return
	}

	for _, res := range results {
		if res.err != nil {
			// Peer unreachable: drop it from the live quorum so a stale ack
			// cannot count toward a phantom majority.
			rn.liveAck[res.url] = false
			continue
		}
		if res.snapshot != nil {
			if res.snapResp.Term > rn.CurrentTerm {
				rn.stepDownLocked(res.snapResp.Term)
				return
			}
			if res.snapResp.Success {
				rn.liveAck[res.url] = true
				if res.snapshot.SnapshotIndex > rn.matchIndex[res.url] {
					rn.matchIndex[res.url] = res.snapshot.SnapshotIndex
				}
				if next := res.snapshot.SnapshotIndex + 1; next > rn.nextIndex[res.url] {
					rn.nextIndex[res.url] = next
				}
			} else {
				rn.liveAck[res.url] = false
			}
			continue
		}
		if res.resp.Term > rn.CurrentTerm {
			rn.stepDownLocked(res.resp.Term)
			return
		}
		if res.resp.Success {
			rn.liveAck[res.url] = true
			// Follower accepted the prefix; monotonically record highest matching index.
			newMatch := res.request.PrevLogIndex + uint64(len(res.request.Entries))
			if newMatch > rn.matchIndex[res.url] {
				rn.matchIndex[res.url] = newMatch
			}
			// nextIndex must never lag matchIndex+1.
			if next := rn.matchIndex[res.url] + 1; next > rn.nextIndex[res.url] {
				rn.nextIndex[res.url] = next
			}
		} else {
			// Peer rejected the append (log mismatch): it must not count
			// toward the live quorum until a fresh success response.
			rn.liveAck[res.url] = false
			if rn.nextIndex[res.url] > 1 && res.request.PrevLogIndex+1 == rn.nextIndex[res.url] {
				rn.nextIndex[res.url]--
			}
		}
	}

	rn.advanceCommitIndexLocked()
	rn.maybeSnapshotLocked()
}

// advanceCommitIndexLocked advances CommitIndex to the highest index replicated
// to a quorum of the cluster (including the leader itself) in the current term,
// then applies committed entries by moving LastApplied forward. Entries from
// previous terms are only committed indirectly once a current-term entry commits
// (Raft §5.4.2).
func (rn *RaftNode) advanceCommitIndexLocked() {
	last := rn.lastLogIndex()
	// Indices at or below the snapshot boundary are compacted away.
	start := rn.CommitIndex + 1
	if start < rn.snapshotIndex+1 {
		start = rn.snapshotIndex + 1
	}
	for n := start; n <= last; n++ {
		if rn.logTermAtLocked(n) != rn.CurrentTerm {
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

// leaderHasLiveQuorumLocked reports whether a majority of the cluster is
// reachable and acknowledging AppendEntries in the current term. Unlike a
// matchIndex-based check it does not trust an optimistically-seeded matchIndex:
// it counts only peers that have completed at least one successful AppendEntries
// round since this node became leader, so a partitioned leader fails fast
// instead of accepting /commit entries it cannot replicate.
func (rn *RaftNode) leaderHasLiveQuorumLocked() bool {
	acked := 1 // self
	for _, url := range rn.PeerURLs {
		if rn.liveAck[url] {
			acked++
		}
	}
	return acked >= rn.quorum()
}

func (rn *RaftNode) clusterStatusLocked() string {
	switch rn.Role {
	case Leader:
		if rn.leaderHasLiveQuorumLocked() {
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
		"node_id":        rn.NodeID,
		"role":           rn.Role,
		"term":           rn.CurrentTerm,
		"voted_for":      rn.VotedFor,
		"leader_id":      rn.LeaderID,
		"commit_index":   rn.CommitIndex,
		"log_length":     len(rn.Log),
		"snapshot_index": rn.snapshotIndex,
		"peers":          rn.Peers,
		"quorum":         rn.quorum(),
		"status":         rn.clusterStatusLocked(),
		"timestamp":      time.Now().Format(time.RFC3339),
	})
}

// HandleVote implements the Raft RequestVote RPC.
func (rn *RaftNode) HandleVote(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}

	var req RequestVoteRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}

	rn.mu.Lock()
	defer rn.mu.Unlock()

	resp := RequestVoteResponse{Term: rn.CurrentTerm, VoteGranted: false}

	if req.Term > rn.CurrentTerm {
		rn.stepDownLocked(req.Term)
		rn.persistMeta()
	}

	if req.Term == rn.CurrentTerm &&
		(rn.VotedFor == "" || rn.VotedFor == req.CandidateID) &&
		rn.isLogUpToDate(req.LastLogIndex, req.LastLogTerm) {
		rn.VotedFor = req.CandidateID
		if err := rn.persister.SaveState(rn.CurrentTerm, rn.VotedFor); err != nil {
			log.Printf("raft persist error: %v", err)
		}
		if err := rn.persistTermLocked(rn.CurrentTerm, rn.VotedFor); err != nil {
			log.Printf("raft persist term error: %v", err)
		}
		rn.lastLeaderSeen = time.Now()
		resp.VoteGranted = true
		rn.persistMeta()
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

// isClusterMember reports whether id identifies this node or a configured Raft peer.
func (rn *RaftNode) isClusterMember(id string) bool {
	if id == "" {
		return false
	}
	if id == rn.NodeID {
		return true
	}
	for _, peerID := range rn.Peers {
		if peerID == id {
			return true
		}
	}
	return false
}

// HandleAppend implements the Raft AppendEntries RPC.
func (rn *RaftNode) HandleAppend(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}

	var req AppendEntriesRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}

	rn.mu.Lock()
	defer rn.mu.Unlock()

	resp := AppendEntriesResponse{Term: rn.CurrentTerm, Success: false}

	if !rn.isClusterMember(req.LeaderID) {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(resp)
		return
	}

	if req.Term > rn.CurrentTerm {
		rn.stepDownLocked(req.Term)
		rn.persistMeta()
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
			rn.persistMeta()
		}
		if err := rn.persister.SaveState(rn.CurrentTerm, rn.VotedFor); err != nil {
			log.Printf("raft persist error: %v", err)
		}
		rn.lastLeaderSeen = time.Now()

		if rn.appendLogFromLeaderLocked(req) {
			if req.LeaderCommit > rn.CommitIndex {
				last := rn.lastLogIndex()
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
			rn.maybeSnapshotLocked()
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
	if req.PrevLogIndex < rn.snapshotIndex {
		return false
	}
	if req.PrevLogIndex == rn.snapshotIndex {
		if req.PrevLogTerm != rn.snapshotTerm {
			return false
		}
	} else {
		prev := rn.Log[rn.logIndex(req.PrevLogIndex)]
		if prev.Term != req.PrevLogTerm {
			return false
		}
	}
	origLen := len(rn.Log)
	var appended []LogEntry
	for i, e := range req.Entries {
		if e.Index <= rn.snapshotIndex {
			continue
		}
		idx := rn.logIndex(e.Index)
		if idx < len(rn.Log) {
			if rn.Log[idx].Term != e.Term {
				appended = req.Entries[i:]
				rn.Log = rn.Log[:idx]
				rn.Log = append(rn.Log, req.Entries[i:]...)
				if err := rn.persister.SaveLog(rn.Log); err != nil {
					log.Printf("raft persist error: %v", err)
				}
				return true
			}
		} else {
			rn.Log = append(rn.Log, req.Entries[i:]...)
			if err := rn.persister.SaveLog(rn.Log); err != nil {
				log.Printf("raft persist error: %v", err)
			}
			return true
		}
	}
	if len(appended) == 0 {
		return true
	}
	// Make the appended entries durable before acknowledging them; if that
	// fails, roll the log back so we never acknowledge entries that are only
	// volatile (Raft §3.5).
	if err := rn.persistEntriesLocked(appended); err != nil {
		rn.Log = rn.Log[:origLen]
		log.Printf("⚠️ node [%s] failed to persist %d replicated entries: %v", rn.NodeID, len(appended), err)
		return false
	}
	return true
}

// writeSnapshotCommitSuccess writes an idempotent success response for an
// entry that has been compacted into the snapshot. Its original timestamp is no
// longer retained, so the response intentionally omits committed_at.
func (rn *RaftNode) writeSnapshotCommitSuccess(w http.ResponseWriter, orderID string) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":           true,
		"already_committed": true,
		"raft_index":       rn.snapshotIndex,
		"term":             rn.snapshotTerm,
		"order_id":         orderID,
	})
}

// writeCommitSuccess writes the success payload for a committed order entry.
func (rn *RaftNode) writeCommitSuccess(w http.ResponseWriter, entry LogEntry, alreadyCommitted ...bool) {
	w.Header().Set("Content-Type", "application/json")
	resp := map[string]interface{}{
		"success":      true,
		"raft_index":   entry.Index,
		"term":         entry.Term,
		"order_id":     entry.OrderID,
		"committed_at": entry.Timestamp.Format(time.RFC3339),
	}
	if len(alreadyCommitted) > 0 && alreadyCommitted[0] {
		resp["already_committed"] = true
	}
	json.NewEncoder(w).Encode(resp)
}

const commitRetryTimeout = 2 * time.Second
const commitRetryInterval = 25 * time.Millisecond

func (rn *RaftNode) waitForCommit(entryIndex uint64) (committed bool, steppedDown bool, entry LogEntry) {
	deadline := time.Now().Add(commitRetryTimeout)
	for {
		rn.sendHeartbeats()

		rn.mu.Lock()
		idx := rn.logIndex(entryIndex)
		if rn.Role != Leader {
			if idx >= 0 && idx < len(rn.Log) {
				entry = rn.Log[idx]
			}
			rn.mu.Unlock()
			return false, true, entry
		}
		committed = rn.CommitIndex >= entryIndex
		if idx >= 0 && idx < len(rn.Log) {
			entry = rn.Log[idx]
		}
		rn.mu.Unlock()

		if committed {
			return true, false, entry
		}
		if time.Now().After(deadline) {
			return false, false, entry
		}
		time.Sleep(commitRetryInterval)
	}
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

	if !decodeJSONBody(w, r, &req) {
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

	if !rn.leaderHasLiveQuorumLocked() {
		rn.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "no cluster quorum",
		})
		return
	}

	// Idempotency: an identical (order_id, command) already present in the retained
	// log or compacted snapshot is never appended again. Snapshot matches are
	// already committed and can be answered without touching the retained log.
	if rn.snapshotIndex > 0 && rn.snapshotState[req.OrderID] == req.Command {
		rn.mu.Unlock()
		rn.writeSnapshotCommitSuccess(w, req.OrderID)
		return
	}

	entryIndex := rn.findEntryLocked(req.OrderID, req.Command, uint64(len(rn.Log)))
	if entryIndex == 0 {
		// State-transition validation: the command must follow the order's
		// recorded lifecycle history.
		last := rn.orderStatesLocked(uint64(len(rn.Log)))[req.OrderID]
		if !canTransition(last, req.Command) {
			rn.mu.Unlock()
			http.Error(w, "invalid state transition for order", http.StatusBadRequest)
			return
		}

		entry := LogEntry{
			Index:     rn.lastLogIndex() + 1,
			Term:      rn.CurrentTerm,
			Command:   req.Command,
			OrderID:   req.OrderID,
			Timestamp: time.Now(),
		}

		// Append to the local log first. CommitIndex is NOT advanced here: the
		// entry must first be replicated to a quorum of followers (Raft §5.3).
		rn.Log = append(rn.Log, entry)
		if err := rn.persister.SaveLog(rn.Log); err != nil {
			log.Printf("raft persist error: %v", err)
		}
		if err := rn.persistEntriesLocked([]LogEntry{entry}); err != nil {
			log.Printf("raft persist error: %v", err)
		}
		entryIndex = entry.Index
	}

	if entryIndex <= rn.CommitIndex {
		// Already committed in a previous round — answer the retry idempotently.
		var e LogEntry
		if idx := rn.logIndex(entryIndex); idx >= 0 && idx < len(rn.Log) {
			e = rn.Log[idx]
		}
		rn.mu.Unlock()
		rn.writeCommitSuccess(w, e, true)
		return
	}

	rn.mu.Unlock()

	committed, steppedDown, entry := rn.waitForCommit(entryIndex)

	if steppedDown {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   false,
			"error":     "stepped down while replicating entry",
			"leader_id": rn.LeaderID,
		})
		return
	}

	if !committed {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":    false,
			"error":      "entry not yet committed to a quorum of followers",
			"raft_index": entryIndex,
		})
		return
	}

	rn.sendHeartbeats()
	rn.writeCommitSuccess(w, entry)
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

	if statePath := os.Getenv("RAFT_STATE_PATH"); statePath != "" {
		if err := node.recoverFromWAL(statePath); err != nil {
			log.Fatalf("Fatal consensus storage error: %v", err)
		}
		log.Printf("💾 node [%s] recovered raft state from %s (log length %d, term %d)", nodeID, len(node.Log), node.CurrentTerm)
	}

	http.HandleFunc("/api/v1/raft/status", node.HandleStatus)
	http.HandleFunc("/api/v1/raft/commit", node.HandleCommitOrder)
	http.HandleFunc("/api/v1/raft/vote", node.HandleVote)
	http.HandleFunc("/api/v1/raft/append", node.HandleAppend)
	http.HandleFunc("/api/v1/raft/snapshot", node.HandleSnapshot)

	log.Printf("🌐 Go Raft Distributed Consensus Node [%s] starting on port %s...", nodeID, port)
	go node.run()
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Fatal consensus server error: %v", err)
	}
}
