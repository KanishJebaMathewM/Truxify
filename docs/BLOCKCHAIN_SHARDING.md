# Blockchain Monitoring & Sharding

## Overview

The Truxify backend monitors Polygon blockchain events and routes order data across Postgres shards by geography.

---

## Location

```
backend/api/src/services/blockchain/blockchainMonitor.js — event polling + alert routing
backend/api/src/services/blockchain/alertRouter.js        — severity-based alert channels
backend/api/src/services/sharding/ShardManager.js         — shard connections + routing
backend/api/src/middleware/shardMiddleware.js             — per-request shard resolution
```

---

## Blockchain Monitoring

`BlockchainMonitor` polls the configured contract for logs (`BLOCKCHAIN_POLL_INTERVAL_MS`, default 12 s), parses events against the escrow ABI, and dispatches to handlers:

| Event | Severity | Action |
|-------|----------|--------|
| PaymentReceived | MEDIUM | store + route alert |
| InsuranceClaimApproved/Rejected | MEDIUM/HIGH | store + route (+ escalate on HIGH) |
| GeofenceBreach | HIGH | store + route + escalate |
| BalanceUpdateFailed | CRITICAL | store + route + escalate |
| SmartContractRevert | CRITICAL | store + route + escalate |

`AlertRouter` maps severity to channels: CRITICAL → Slack+SMS+email, HIGH → Slack+email, MEDIUM → Slack, LOW → dashboard. Escalation uses the escalation handler for HIGH/CRITICAL.

## Sharding

`ShardManager` maintains per-shard Postgres pools (north/south/east/west). `shardMiddleware` resolves the shard from coordinates, attaches `req.shard`/`req.shardConnection`, and sets `X-Shard` headers. `crossShardQuery` fans a query out across shards and aggregates results.

---

## Why It Exists

On-chain monitoring closes the loop on escrow and payment events that cannot be observed in the database, and geographic sharding keeps per-shard datasets regional for latency and size control.

---

## Testing

Automated tests verify:

- Event handler routing and escalation.
- Alert channel mapping and formatting.
- Shard resolution, coordinate validation, and cross-shard queries.
