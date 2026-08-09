# Blockchain State Divergence Detection

## Overview

Monitors Polygon blockchain state consistency across multiple RPC nodes, detects divergence when off-chain cache diverges from on-chain reality, and automatically initiates state reconciliation. Prevents payment miscalculations and data integrity issues caused by network congestion and slow transaction finality.

## Problem Addressed

### Divergence Scenario
```
2:00 PM - Driver completes delivery, submits proof to Polygon
2:05 PM - Transaction enters mempool (waiting)
2:00 PM - Off-chain cache shows 'Completed'
5:00 PM - Transaction finally mines on-chain
5:05 PM - Off-chain cache still shows different state
Result: 3+ hour divergence, driver payment disputes
```

### Root Causes
- ❌ Single RPC node (no redundancy)
- ❌ No block height tracking
- ❌ No finality checks (transaction might revert)
- ❌ Network congestion causes stale data
- ❌ No automatic state reconciliation

## Solution

**Event-Sourced Blockchain State Machine**
1. Query multiple RPC nodes in parallel
2. Detect divergence across nodes
3. Return canonical state (highest block number)
4. Track transaction finality (>100 blocks = finalized)
5. Automatic state reconciliation on divergence

## Architecture

### StateDivergenceDetector Service

**Continuous Monitoring:**
- Polls all RPC nodes every 30 seconds (configurable)
- Queries block number and hash from each node
- Analyzes for divergence (blocks behind leader)
- Alerts if divergence exceeds threshold

**Divergence Severity:**
| Blocks Behind | Severity | Action |
|---|---|---|
| 0 | NONE | Monitor |
| 1-5 | LOW | Log |
| 6-20 | MEDIUM | Alert + Log |
| 21-50 | HIGH | Alert + Log + Notify |
| 50+ | CRITICAL | Block + Alert + Reconcile |

**Finality Checking:**
- Transactions finalized after 100 blocks (EIP-1559)
- Provides confirmation of immutability
- Prevents relying on unconfirmed state

**State Reconciliation:**
- Queues reconciliation jobs when CRITICAL divergence
- Replays blockchain state from canonical node
- Updates off-chain cache to match on-chain reality

## Configuration

### Environment Variables

```env
# Multiple RPC Nodes
POLYGON_RPC_NODES=https://polygon-rpc1.com,https://polygon-rpc2.com,https://polygon-rpc3.com
POLYGON_RPC_URL=https://polygon-rpc.com           # Fallback if RPC_NODES not set

# Divergence Detection
DIVERGENCE_CHECK_INTERVAL_MS=30000               # Check every 30 seconds
FINALITY_THRESHOLD=100                            # Blocks until finalized (immutable)
DIVERGENCE_CRITICAL_BLOCKS=50                     # Blocks = CRITICAL severity
RPC_TIMEOUT_MS=10000                              # 10 second timeout per RPC call
```

### RPC Node Setup

**Requirements:**
- At least 3 independent RPC nodes for consensus
- Different infrastructure providers (not same cloud region)
- Redundant network connectivity
- Recommended: One local Polygon validator node

**Example Configuration:**
```env
POLYGON_RPC_NODES=\
  https://polygon-rpc.com,\
  https://polygon-pokt.nodies.app,\
  https://rpc-mainnet.matic.network,\
  ws://internal-validator:8545
```

## API

### Check for Divergence

```javascript
const divergenceResult = await detector.checkForDivergence();

// Response:
{
  divergenceDetected: true,
  divergenceSeverity: 'HIGH',
  blockDivergence: 15,
  nodeCount: 3,
  maxBlockNumber: 45123456,
  minBlockNumber: 45123441,
  canonicalState: { blockNumber: 45123456, ... },
  nodeStates: [ /* array of all node states */ ]
}
```

### Get Consensus State

```javascript
const consensus = await detector.getConsensusState();

// Returns state from node with highest block number
{
  blockNumber: 45123456,
  blockHash: '0x...',
  blockTimestamp: 1630769200,
  transactionCount: 245,
  nodeIndex: 0,
  rpcUrl: 'https://polygon-rpc.com'
}
```

### Check Transaction Finality

```javascript
const finality = await detector.checkTransactionFinality(txHash, currentBlockNumber);

// Response:
{
  finalized: true,
  blockNumber: 45123200,
  blocksSinceTransaction: 256,
  finalityThreshold: 100,
  status: 'success',
  txHash: '0x...'
}
```

### Reconcile States

```javascript
const reconciliation = await detector.reconcileState(oldState, newState);

// Response:
{
  reconciliationId: 'recon_1234567890_abc123',
  oldState: { blockNumber: 45123400 },
  newState: { blockNumber: 45123456 },
  blockNumberDifference: 56,
  status: 'in_progress',
  initiatedAt: '2024-01-01T12:00:00.000Z'
}
```

### Get Metrics

```javascript
const metrics = detector.getDivergenceMetrics();

// Response:
{
  totalDivergences: 5,
  activeDivergences: 1,
  lastChecked: '2024-01-01T12:05:30.000Z',
  rpcNodeCount: 3
}
```

## Integration Example

```javascript
import StateDivergenceDetector from './services/blockchain/stateDivergenceDetector.js';

// Initialize
const detector = new StateDivergenceDetector();

// Get canonical state before critical operations
const consensusState = await detector.getConsensusState();
const currentBlockNumber = consensusState.blockNumber;

// Verify transaction finality before releasing payment
const finality = await detector.checkTransactionFinality(txHash, currentBlockNumber);
if (!finality.finalized) {
  return res.status(202).json({
    status: 'pending',
    blocksUntilFinalized: FINALITY_THRESHOLD - finality.blocksSinceTransaction,
    message: 'Payment confirmation pending blockchain finality'
  });
}

// Release payment only after confirmed finality
await releaseDriverPayment(driverId, amount);
```

## Database Schema

### blockchain_divergence_log
```sql
CREATE TABLE blockchain_divergence_log (
  divergence_id VARCHAR(255) PRIMARY KEY,
  severity VARCHAR(50),              -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  block_divergence INT,
  node_states JSONB,                -- Array of all node block states
  canonical_state JSONB,            -- State from highest block
  detected_at TIMESTAMP,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP,
  resolution_details JSONB
);

CREATE INDEX idx_divergence_log_severity ON blockchain_divergence_log(severity);
CREATE INDEX idx_divergence_log_detected_at ON blockchain_divergence_log(detected_at);
```

### blockchain_reconciliation_jobs
```sql
CREATE TABLE blockchain_reconciliation_jobs (
  id UUID PRIMARY KEY,
  status VARCHAR(50),                -- 'pending', 'in_progress', 'completed', 'failed'
  source_block_number INT,
  canonical_state JSONB,
  result JSONB,
  created_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_reconciliation_jobs_status ON blockchain_reconciliation_jobs(status);
```

### state_reconciliations
```sql
CREATE TABLE state_reconciliations (
  reconciliation_id VARCHAR(255) PRIMARY KEY,
  old_state JSONB,
  new_state JSONB,
  block_number_difference INT,
  initiated_at TIMESTAMP,
  completed_at TIMESTAMP,
  status VARCHAR(50)
);
```

## Monitoring

### Key Metrics
- **Divergence Frequency**: How often divergence is detected
- **Divergence Severity**: Distribution of LOW/MEDIUM/HIGH/CRITICAL events
- **Resolution Time**: Time from divergence detection to resolution
- **RPC Node Reliability**: % of successful queries per node
- **Finality Rate**: % of transactions achieving >100 block confirmation

### Alerting Rules

| Event | Severity | Action |
|---|---|---|
| Divergence > 50 blocks | CRITICAL | Page on-call, trigger reconciliation |
| Divergence > 20 blocks | HIGH | Email ops team, log event |
| Divergence > 5 blocks | MEDIUM | Log event, monitor |
| Node unable to respond | HIGH | Failover, notify OPS |
| All nodes down | CRITICAL | Emergency mode, block payments |

## Testing

### Unit Tests
```javascript
describe('StateDivergenceDetector', () => {
  test('detects divergence correctly', async () => {
    const nodeStates = [
      { blockNumber: 1000, blockHash: '0xa' },
      { blockNumber: 985, blockHash: '0xb' },
      { blockNumber: 990, blockHash: '0xc' },
    ];
    
    const result = detector.analyzeDivergence(nodeStates);
    expect(result.divergenceDetected).toBe(true);
    expect(result.blockDivergence).toBe(15);
  });

  test('calculates finality correctly', async () => {
    const finality = await detector.checkTransactionFinality(txHash, 1100);
    expect(finality.blocksSinceTransaction).toBe(100);
    expect(finality.finalized).toBe(true);
  });
});
```

### Integration Tests
1. Start 3 RPC nodes with staggered block times
2. Detect divergence correctly
3. Verify canonical state selection (highest block)
4. Verify finality checks
5. Trigger reconciliation on CRITICAL divergence
6. Verify state convergence after reconciliation

## Performance

- **Block checking**: ~100ms per node (3 nodes = ~300ms total)
- **Memory usage**: ~10MB for state tracking
- **Database writes**: ~10 per day (only on divergence)
- **Finality check**: ~50ms per transaction

## Troubleshooting

### Divergence Not Detected
- Check POLYGON_RPC_NODES environment variable
- Verify RPC nodes are responding (curl endpoint)
- Check DIVERGENCE_CHECK_INTERVAL_MS is set correctly

### Reconciliation Stuck
- Check blockchain_reconciliation_jobs table
- Verify canonical state is correct
- Check off-chain cache consistency

### False Positives
- Increase divergence tolerance (normal variance is 1-2 blocks)
- Add more RPC nodes for better consensus
- Check for network latency causing false divergence

## Standards & References

- **EIP-1559**: Ethereum transaction finality (100 blocks)
- **PBFT Consensus**: Byzantine Fault Tolerance for state agreement
- **Event Sourcing**: Immutable audit trail of state changes
- **CQRS Architecture**: Separate read/write models

## Future Enhancements

- [ ] Multi-chain support (Ethereum, Arbitrum, Optimism)
- [ ] Automatic RPC node rotation based on reliability
- [ ] Predictive divergence detection using ML
- [ ] Batch transaction finality checking
- [ ] Smart contract state validation
- [ ] Cross-chain state verification
