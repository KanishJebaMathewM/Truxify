# 🌐 Truxify Go Raft Distributed Consensus Node

This directory contains the **Go Raft Distributed Consensus Engine** designed for multi-region database sharding consensus, atomic order state machine locking, and zero-downtime leader election across logistics hub clusters.

---

## 🌐 Raft Consensus Features

- **Distributed State Machine**: Guarantees linearizable order state transitions (`CREATED` $\rightarrow$ `DISPATCHED` $\rightarrow$ `COMPLETED`) across multi-cloud regions.
- **Leader Election & Heartbeats**: Nodes start as `FOLLOWER`, campaign for leadership via `RequestVote` RPCs, and keep leadership with `AppendEntries` heartbeats and term bumps (Raft paper §5).
- **Atomic Log Replication**: Appends transactional state transition entries into an append-only WAL log and replicates them to a quorum of followers (AppendEntries + `nextIndex`/`matchIndex` tracking) before advancing `CommitIndex`. `/commit` returns success only once the entry is replicated to a quorum and committed.
- **Quorum-Aware Health**: `/api/v1/raft/status` reports `HEALTHY_CLUSTER` only when a leader has quorum; `NO_LEADER`, `ELECTION_IN_PROGRESS`, and `UNHEALTHY_CLUSTER` are reported otherwise.

---

## 🔌 REST Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/raft/status` | `GET` | Returns node role, current term, leader id, log length, quorum, and cluster health. |
| `/api/v1/raft/commit` | `POST` | Commits an order entry. The leader appends the entry, replicates it to followers via `AppendEntries`, and advances `CommitIndex` only once a quorum acknowledges it — success is returned only after the entry is committed (and the updated commit index is propagated). Non-leaders return `409` with the current `leader_id`; without quorum it returns `503`. |
| `/api/v1/raft/vote` | `POST` | Internal Raft `RequestVote` RPC used during elections. |
| `/api/v1/raft/append` | `POST` | Internal Raft `AppendEntries` (heartbeat) RPC used by the leader. |

---

## ⚙️ Configuration

| Env var | Default | Description |
| :--- | :--- | :--- |
| `RAFT_PORT` | `8089` | HTTP listen port. |
| `NODE_ID` | `raft-node-north-1` | Unique id for this node. |
| `RAFT_PEER_IDS` | `raft-node-south-1,...` | Comma-separated peer node ids reported in `/status`. |
| `RAFT_PEER_URLS` | *(none)* | Comma-separated `scheme://host:port` base URLs of peers used for `vote`/`append` RPCs. When empty, the node cannot reach a quorum and stays in `NO_LEADER`/`UNHEALTHY_CLUSTER` until a leader is reachable. A single-node cluster with no peers elects itself. |
| `RAFT_HEARTBEAT_MS` | `100` | Leader heartbeat interval. |
| `RAFT_ELECTION_TIMEOUT_MIN_MS` | `500` | Lower bound of the randomized election timeout. |
| `RAFT_ELECTION_TIMEOUT_MAX_MS` | `1200` | Upper bound of the randomized election timeout. |
| `RAFT_API_KEY` | — | Shared service-to-service API key required on every endpoint. When unset, authenticated requests are rejected (`503`). |
| `RAFT_ALLOWED_COMMANDS` | `CREATED,DISPATCHED,IN_TRANSIT,DELIVERED,COMPLETED,CANCELLED` | Comma-separated allow-list of order commands accepted by `/commit`. |

---

## 🔐 Authentication

All raft endpoints require the service-to-service API key configured via `RAFT_API_KEY`, sent as the `X-API-Key` header. Requests without a matching key return `401`; if `RAFT_API_KEY` is unset the endpoints fail closed (`503`). For local development only, set `BYPASS_AUTH=true` (with `NODE_ENV != production`) to skip the check.

Commit requests are validated before they touch the log:

- `order_id` must be non-empty, at most 64 chars, and contain only `[A-Za-z0-9_-]`.
- `command` must be in the allow-list (`CREATED`, `DISPATCHED`, `IN_TRANSIT`, `DELIVERED`, `COMPLETED`, `CANCELLED`), overridable via `RAFT_ALLOWED_COMMANDS` (comma-separated).

---

## 🐳 Docker Deployment

```bash
# Build container image
docker build -t truxify-raft-go services/consensus-raft-go/

# Run container
docker run -p 8089:8089 truxify-raft-go
```
