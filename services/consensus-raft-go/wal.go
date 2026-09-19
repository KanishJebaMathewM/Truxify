package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
)

// WALEntry represents a single write-ahead log entry.
type WALEntry struct {
	Type    string      `json:"type"`    // "term", "vote", "log", "commit"
	Term    uint64      `json:"term"`
	Index   uint64      `json:"index,omitempty"`
	Command interface{} `json:"command,omitempty"`
	VotedFor string    `json:"voted_for,omitempty"`
}

// WriteAheadLog provides durable storage for Raft state.
// All state changes are appended to the WAL before being applied.
type WriteAheadLog struct {
	mu       sync.Mutex
	file     *os.File
	writer   *bufio.Writer
	path     string
	syncMode bool // If true, fsync after every write
}

// NewWAL creates a new write-ahead log at the specified path.
func NewWAL(dataDir string, syncMode bool) (*WriteAheadLog, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create WAL directory: %w", err)
	}

	walPath := filepath.Join(dataDir, "raft.wal")
	
	file, err := os.OpenFile(walPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open WAL file: %w", err)
	}

	return &WriteAheadLog{
		file:     file,
		writer:   bufio.NewWriter(file),
		path:     walPath,
		syncMode: syncMode,
	}, nil
}

// Append writes an entry to the WAL and optionally fsyncs.
func (w *WAL) Append(entry WALEntry) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	data, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("failed to marshal WAL entry: %w", err)
	}

	// Write entry followed by newline
	if _, err := w.writer.Write(data); err != nil {
		return fmt.Errorf("failed to write WAL entry: %w", err)
	}
	if _, err := w.writer.WriteString("\n"); err != nil {
		return fmt.Errorf("failed to write WAL newline: %w", err)
	}

	// Flush buffer
	if err := w.writer.Flush(); err != nil {
		return fmt.Errorf("failed to flush WAL: %w", err)
	}

	// Fsync if in strict mode (required for Raft safety)
	if w.syncMode {
		if err := w.file.Sync(); err != nil {
			return fmt.Errorf("failed to fsync WAL: %w", err)
		}
	}

	return nil
}

// AppendTermChange records a term change.
func (w *WAL) AppendTermChange(term uint64) error {
	return w.Append(WALEntry{
		Type: "term",
		Term: term,
	})
}

// AppendVote records a vote cast.
func (w *WAL) AppendVote(term uint64, votedFor string) error {
	return w.Append(WALEntry{
		Type:     "vote",
		Term:     term,
		VotedFor: votedFor,
	})
}

// AppendLogEntry records a new log entry.
func (w *WAL) AppendLogEntry(term, index uint64, command interface{}) error {
	return w.Append(WALEntry{
		Type:    "log",
		Term:    term,
		Index:   index,
		Command: command,
	})
}

// AppendCommit records a commit index advancement.
func (w *WAL) AppendCommit(commitIndex uint64) error {
	return w.Append(WALEntry{
		Type:  "commit",
		Index: commitIndex,
	})
}

// Replay reads all entries from the WAL and returns them in order.
func (w *WAL) Replay() ([]WALEntry, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	file, err := os.Open(w.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []WALEntry{}, nil
		}
		return nil, fmt.Errorf("failed to open WAL for replay: %w", err)
	}
	defer file.Close()

	var entries []WALEntry
	scanner := bufio.NewScanner(file)
	
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var entry WALEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			// Corrupted entry - stop replay here
			// In production, we might want to truncate the WAL
			return entries, fmt.Errorf("failed to unmarshal WAL entry: %w", err)
		}
		entries = append(entries, entry)
	}

	if err := scanner.Err(); err != nil {
		return entries, fmt.Errorf("error reading WAL: %w", err)
	}

	return entries, nil
}

// Truncate removes all entries from the WAL (used after snapshot).
func (w *WAL) Truncate() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Close current file
	if err := w.writer.Flush(); err != nil {
		return err
	}
	if err := w.file.Close(); err != nil {
		return err
	}

	// Reopen with truncate flag
	file, err := os.OpenFile(w.path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to truncate WAL: %w", err)
	}

	w.file = file
	w.writer = bufio.NewWriter(file)

	return nil
}

// Close closes the WAL file.
func (w *WAL) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if err := w.writer.Flush(); err != nil {
		return err
	}
	return w.file.Close()
}

// Fsync forces a sync to disk (for critical state changes).
func (w *WAL) Fsync() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if err := w.writer.Flush(); err != nil {
		return err
	}
	return w.file.Sync()
}

// Size returns the current WAL file size in bytes.
func (w *WAL) Size() (int64, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	info, err := w.file.Stat()
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

// RecoverState replays the WAL and reconstructs Raft state.
func RecoverState(dataDir string) (*RaftState, error) {
	wal, err := NewWAL(dataDir, false)
	if err != nil {
		return nil, err
	}
	defer wal.Close()

	entries, err := wal.Replay()
	if err != nil {
		return nil, fmt.Errorf("failed to replay WAL: %w", err)
	}

	state := &RaftState{
		CurrentTerm: 0,
		VotedFor:    "",
		Log:         []LogEntry{},
		CommitIndex: 0,
		LastApplied: 0,
	}

	for _, entry := range entries {
		switch entry.Type {
		case "term":
			state.CurrentTerm = entry.Term
			state.VotedFor = "" // Reset vote on term change
		case "vote":
			if entry.Term == state.CurrentTerm {
				state.VotedFor = entry.VotedFor
			}
		case "log":
			state.Log = append(state.Log, LogEntry{
				Term:    entry.Term,
				Index:   entry.Index,
				Command: entry.Command,
			})
		case "commit":
			if entry.Index > state.CommitIndex {
				state.CommitIndex = entry.Index
			}
		}
	}

	return state, nil
}

// RaftState represents the recovered state from WAL.
type RaftState struct {
	CurrentTerm uint64
	VotedFor    string
	Log         []LogEntry
	CommitIndex uint64
	LastApplied uint64
}

// ForceSync is a helper that ensures data is on disk.
// Uses fdatasync on Linux for better performance than fsync.
func ForceSync(f *os.File) error {
	return syscall.Fdatasync(int(f.Fd()))
}
