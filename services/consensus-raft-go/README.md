# 🌐 Truxify Go Raft Distributed Consensus Node

This directory contains the **Go Raft Distributed Consensus Engine** designed for multi-region database sharding consensus, atomic order state machine locking, and zero-downtime leader election across logistics hub clusters.

---

## 🌐 Raft Consensus Features

- **Distributed State Machine**: Guarantees linearizable order state transitions (`CREATED` $\rightarrow$ `DISPATCHED` $\rightarrow$ `COMPLETED`) across multi-cloud regions.
- **Leader Election & Heartbeats**: Built-in leader election timer and term bump logic to survive regional network partitions.
- **Atomic Log Replication**: Appends transactional state transition entries into an append-only WAL log.

---

## 🐳 Docker Deployment

```bash
# Build container image
docker build -t truxify-raft-go services/consensus-raft-go/

# Run container
docker run -p 8089:8089 truxify-raft-go
```
