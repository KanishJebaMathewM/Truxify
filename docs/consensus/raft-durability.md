# Raft Consensus Durability Architecture

## Overview
The Raft consensus service (`services/consensus-raft-go`) provides the single source of truth for order lifecycle state transitions. This document describes the durability layer that ensures committed state survives node restarts.

**Issue #11254**: Previously, all Raft state was kept in memory only. Committed orders would vanish on pod restart, breaking the consensus guarantee.

## Architecture

### Components

1. **Write-Ahead Log (WAL)** - `wal.go`
   - Append-only log of all state changes
   - Fsync after every critical write
   - Replayed on startup to restore state

2. **Snapshot Manager** - `snapshot.go`
   - Periodic snapshots of applied state
   - Log compaction after snapshot
   - Fast recovery for nodes with long history

3. **State Recovery** - Integrated into `main.go`
   - Load snapshot (if exists)
   - Replay WAL entries after snapshot
   - Restore CurrentTerm, VotedFor, Log, CommitIndex

## WAL Entry Types

| Type | When Written | Durability Requirement |
|------|-------------|----------------------|
| `term` | Term change | Fsync required (§5.2) |
| `vote` | Vote cast | Fsync required (§5.2) |
| `log` | Log entry appended | Fsync before ack (§5.3) |
| `commit` | CommitIndex advanced | Fsync required |

### WAL Entry Format
```json
{"type": "term", "term": 5}
{"type": "vote", "term": 5, "voted_for": "node-2"}
{"type": "log", "term": 5, "index": 42, "command": {...}}
{"type": "commit", "index": 42}
```

## Recovery Process

On node startup:

```
1. Load latest snapshot (if exists)
   - Restore state machine
   - Set LastIncludedIndex/Term

2. Replay WAL entries
   - Skip entries before snapshot
   - Apply term changes
   - Restore VotedFor
   - Rebuild Log
   - Restore CommitIndex

3. Re-apply CommitIndex → LastApplied
   - Apply committed entries to state machine
   - Update LastApplied

4. Start Raft run loop
```

## Safety Guarantees

### 1. Vote Safety (§5.2)
**Problem**: A node that voted for A in term 5 must not vote for B in term 5 after restart.

**Solution**: `VotedFor` is persisted on every vote. On recovery, the node remembers its vote.

```go
// Before responding to RequestVote
wal.AppendTermChange(currentTerm)
wal.AppendVote(currentTerm, candidateID)
wal.Fsync()  // Critical: must be on disk before responding
```

### 2. Log Durability (§5.3)
**Problem**: Committed entries must not be lost.

**Solution**: Every log entry is fsynced before the leader responds with success.

```go
func (rn *RaftNode) HandleCommitOrder(cmd map[string]string) {
    entry := LogEntry{Term: rn.CurrentTerm, Index: nextIndex, Command: cmd}
    
    // Append to WAL and fsync BEFORE adding to in-memory log
    wal.AppendLogEntry(entry.Term, entry.Index, entry.Command)
    wal.Fsync()
    
    // Now safe to add to in-memory log
    rn.Log = append(rn.Log, entry)
    
    // Advance commit index
    rn.CommitIndex = entry.Index
    wal.AppendCommit(rn.CommitIndex)
    wal.Fsync()
}
```

### 3. Term Monotonicity
**Problem**: Term must never decrease.

**Solution**: Term changes are persisted. On recovery, the node starts with the recovered term.

## Snapshot Compaction

The WAL grows unbounded. Periodic snapshots allow log compaction:

```
Trigger: When (LastLogIndex - LastSnapshotIndex) > threshold (default: 1000)

Process:
1. Snapshot state machine at LastApplied
2. Write snapshot to disk
3. Truncate WAL entries before snapshot
4. Continue with shorter WAL
```

### Recovery with Snapshot
```
1. Load snapshot (e.g., state at index 1000)
2. Replay WAL entries after index 1000
3. Result: Full state with compact WAL
```

## Configuration

Environment variables:
```bash
RAFT_DATA_DIR=/var/lib/raft      # WAL and snapshot directory
RAFT_SYNC_MODE=strict            # "strict" (fsync every write) or "batch"
RAFT_SNAPSHOT_THRESHOLD=1000     # Entries between snapshots
```

## Testing

```bash
cd services/consensus-raft-go
go test -v -run TestWAL
go test -v -run TestSnapshot
go test -v -run TestRaftNodeRestart
go test -v -race  # Race detector
```

### Key Tests
- `TestWALRecovery` - State survives restart
- `TestVoteNotRegrantedAfterRestart` - Vote safety
- `TestRaftNodeRestart` - Committed orders persist
- `TestSnapshotCompaction` - Log compaction works

## Deployment

### Kubernetes Volume Mount
```yaml
apiVersion: apps/v1
kind: StatefulSet
spec:
  template:
    spec:
      containers:
      - name: raft
        volumeMounts:
        - name: raft-data
          mountPath: /var/lib/raft
  volumeClaimTemplates:
  - metadata:
      name: raft-data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi
```

### Helm Values
```yaml
persistence:
  enabled: true
  size: 10Gi
  storageClass: "standard"
```

## Performance Impact

| Operation | Without Durability | With Durability |
|-----------|-------------------|-----------------|
| Commit latency | ~1ms | ~5-10ms (fsync) |
| Recovery time | Instant (empty) | 100ms-10s (replay) |
| Throughput | Unlimited | ~1000 commits/sec |

### Optimization: Batch Fsync
For high-throughput scenarios, use batch mode:
```bash
RAFT_SYNC_MODE=batch  # Fsync every 10ms instead of every write
```

This trades a small durability window (10ms of data) for 10x throughput.

## Migration from In-Memory

1. Deploy new version with persistence
2. Existing nodes start with empty WAL (first run)
3. New commits are durable going forward
4. Historical state is lost (acceptable for fresh deployment)

For zero-downtime migration with state preservation, use snapshot export/import.

## Related Issues
- #11254 - This fix
- Raft paper §5.2 (Voting), §5.3 (Log replication), §7 (Log compaction)

