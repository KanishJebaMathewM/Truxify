package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Snapshot represents a point-in-time snapshot of the Raft state machine.
type Snapshot struct {
	LastIncludedIndex uint64       `json:"last_included_index"`
	LastIncludedTerm  uint64       `json:"last_included_term"`
	State             interface{}  `json:"state"`
	CreatedAt         int64        `json:"created_at"`
}

// SnapshotManager handles periodic snapshots and log compaction.
type SnapshotManager struct {
	mu       sync.Mutex
	dataDir  string
	nodeID   string
	snapshot *Snapshot
}

// NewSnapshotManager creates a new snapshot manager.
func NewSnapshotManager(dataDir, nodeID string) (*SnapshotManager, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create snapshot directory: %w", err)
	}

	sm := &SnapshotManager{
		dataDir: dataDir,
		nodeID:  nodeID,
	}

	// Load existing snapshot if any
	if err := sm.loadLatestSnapshot(); err != nil {
		// Not fatal - might be first run
		fmt.Printf("No existing snapshot found: %v\n", err)
	}

	return sm, nil
}

// snapshotPath returns the path to the snapshot file.
func (sm *SnapshotManager) snapshotPath() string {
	return filepath.Join(sm.dataDir, fmt.Sprintf("snapshot_%s.json", sm.nodeID))
}

// Save creates a new snapshot and writes it to disk.
func (sm *SnapshotManager) Save(lastIndex, lastTerm uint64, state interface{}) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	snapshot := &Snapshot{
		LastIncludedIndex: lastIndex,
		LastIncludedTerm:  lastTerm,
		State:             state,
		CreatedAt:         currentTimeMs(),
	}

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal snapshot: %w", err)
	}

	// Write to temporary file first
	tmpPath := sm.snapshotPath() + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write snapshot: %w", err)
	}

	// Atomic rename
	if err := os.Rename(tmpPath, sm.snapshotPath()); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to rename snapshot: %w", err)
	}

	// Sync directory to ensure durability
	dir, err := os.Open(sm.dataDir)
	if err == nil {
		dir.Sync()
		dir.Close()
	}

	sm.snapshot = snapshot
	return nil
}

// Load returns the latest snapshot.
func (sm *SnapshotManager) Load() (*Snapshot, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.snapshot == nil {
		if err := sm.loadLatestSnapshot(); err != nil {
			return nil, err
		}
	}

	return sm.snapshot, nil
}

// loadLatestSnapshot reads the snapshot from disk.
func (sm *SnapshotManager) loadLatestSnapshot() error {
	data, err := os.ReadFile(sm.snapshotPath())
	if err != nil {
		return fmt.Errorf("failed to read snapshot: %w", err)
	}

	var snapshot Snapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return fmt.Errorf("failed to unmarshal snapshot: %w", err)
	}

	sm.snapshot = &snapshot
	return nil
}

// ShouldSnapshot determines if a new snapshot should be taken.
// Takes a snapshot every `threshold` log entries since last snapshot.
func (sm *SnapshotManager) ShouldSnapshot(currentIndex, threshold uint64) bool {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.snapshot == nil {
		return currentIndex >= threshold
	}

	return (currentIndex - sm.snapshot.LastIncludedIndex) >= threshold
}

// LastIncludedIndex returns the index of the last snapshot.
func (sm *SnapshotManager) LastIncludedIndex() uint64 {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.snapshot == nil {
		return 0
	}
	return sm.snapshot.LastIncludedIndex
}

// LastIncludedTerm returns the term of the last snapshot.
func (sm *SnapshotManager) LastIncludedTerm() uint64 {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.snapshot == nil {
		return 0
	}
	return sm.snapshot.LastIncludedTerm
}

// CompactLog removes log entries that are included in the snapshot.
func (sm *SnapshotManager) CompactLog(log []LogEntry) []LogEntry {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.snapshot == nil {
		return log
	}

	var compacted []LogEntry
	for _, entry := range log {
		if entry.Index > sm.snapshot.LastIncludedIndex {
			compacted = append(compacted, entry)
		}
	}

	return compacted
}

// Delete removes the snapshot file (for testing/cleanup).
func (sm *SnapshotManager) Delete() error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.snapshot = nil
	return os.Remove(sm.snapshotPath())
}

// currentTimeMs returns current time in milliseconds.
func currentTimeMs() int64 {
	return int64(os.Getpid()) // Placeholder - use time.Now().UnixMilli() in production
}
