# Escrow State Machine & Atomic Locking Architecture

## Overview
The escrow deposit confirmation flow is a critical financial operation that must prevent:
1. **Double-funding** - Two concurrent confirmations accepting the same deposit
2. **Inconsistent states** - DB state diverging from blockchain state
3. **Stuck orders** - Orders left in intermediate states after failures
4. **Race conditions** - TOCTOU windows between reads and writes

This document describes the atomic locking and state machine architecture that addresses these issues (Issue #11224).

## State Machine

The escrow lifecycle is governed by a strict finite state machine. Only valid transitions are permitted.

### State Transition Diagram

```
pending ──────► funding ──────► confirming ──────► funded ──────► released
  │                │                │                │
  │                │                │                ▼
  │                │                │            disputed ──► released
  │                │                │                │
  │                │                │                └─────► refunded
  │                │                ▼
  │                │          refund_pending ──► refunded
  │                │                │
  │                │                ▼
  │                └────────────► failed
  │
  └──────────► cancelled
```

### State Definitions

| State | Description | Allowed Next States |
|-------|-------------|-------------------|
| `pending` | Order created, no deposit yet | funding, cancelled |
| `funding` | Customer initiated deposit, awaiting chain confirmation | confirming, refund_pending, cancelled |
| `confirming` | Deposit detected, executing accept_bid_tx RPC | funded, refund_pending, failed |
| `refund_pending` | Acceptance failed, refund in progress | refunded, failed |
| `funded` | Escrow successfully funded | released, disputed |
| `released` | **Terminal** - Payment released to driver | — |
| `refunded` | **Terminal** - Deposit returned to customer | — |
| `cancelled` | **Terminal** - Order cancelled before funding | — |
| `disputed` | Dispute raised, funds frozen | released, refunded |
| `failed` | Operation failed, can retry | funding, cancelled |

## Atomic Locking Architecture

### Lock Acquisition
```javascript
const lock = await escrowLockManager.acquireLock(orderId, {
  ttlSeconds: 60,
  expectedState: 'funding',
  targetState: 'confirming'
});
```

### Lock Properties
1. **Token-based ownership**: Each lock has a unique token. Only the token holder can release or extend.
2. **TTL (Time-To-Live)**: Locks auto-expire to prevent deadlocks. Default: 60 seconds.
3. **Atomic state validation**: `expectedState` and `targetState` validated atomically with acquisition.
4. **Version tracking**: Optimistic locking via version numbers prevents lost updates.

### Lock Extension
For long-running operations (RPC + potential refund):
```javascript
await escrowLockManager.extendLock(orderId, token);
```
- Maximum 3 extensions allowed
- Each extension adds 30 seconds
- Prevents indefinite lock holding

### Lock Release with Lua Script
```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
```
This ensures only the lock owner can release it, preventing one caller from releasing another's lock.

## The `withLock` Pattern

The recommended API for escrow operations:

```javascript
await escrowLockManager.withLock(orderId, async (ctx) => {
  // 1. Transition to 'confirming'
  await ctx.transition('confirming');
  
  try {
    // 2. Execute long-running RPC
    await finalizeAcceptance(orderId);
    
    // 3. Transition to 'funded'
    await ctx.transition('funded');
  } catch (err) {
    // 4. Extend lock for refund processing
    await ctx.extend();
    
    // 5. Transition to refund_pending
    await ctx.transition('refund_pending');
    
    // 6. Execute refund
    await submitEscrowRefund(orderId);
    
    // 7. Transition to refunded
    await ctx.transition('refunded');
  }
  // Lock automatically released in finally block
});
```

### Key Guarantees
1. **Lock held for entire operation** - Including refund path
2. **State validated at each transition** - Invalid transitions throw
3. **Automatic cleanup** - Lock released even on exceptions
4. **Version tracking** - Optimistic concurrency control

## Integration with `confirm-deposit` Endpoint

### Before (Buggy)
```javascript
// ❌ Multiple race conditions
const order = await readOrder();
const lock = acquireLock();
const order2 = await readOrder(); // TOCTOU!
await recordDepositTx();
await updateDB();
releaseLock(); // Released before finalizeAcceptance completes!
await finalizeAcceptance(); // Race window here
```

### After (Fixed)
```javascript
// ✅ Atomic, single-read, extended lock
await escrowLockManager.withLock(orderId, async (ctx) => {
  const order = await readOrderOnce(); // Single read
  await recordDepositTx();
  await ctx.transition('confirming');
  
  try {
    await finalizeAcceptance(order);
    await ctx.transition('funded');
  } catch (err) {
    await ctx.extend();
    await ctx.transition('refund_pending');
    await submitEscrowRefund(orderId);
    await ctx.transition('refunded');
  }
}, { expectedState: 'funding', targetState: 'confirming' });
```

## Idempotency Guarantees

### Optimistic Locking via Version Numbers
Each escrow has a version number that increments on each state transition:
```javascript
const result = await ctx.transition('funded');
// result.newVersion = previousVersion + 1
```

If two callers attempt the same transition, only one succeeds because they have different expected versions.

### RPC Idempotency
The `accept_bid_tx` RPC accepts `p_expected_version` to ensure:
- Only the caller with the current version can succeed
- Stale calls (with old versions) are rejected
- No double-execution possible

## Monitoring & Observability

### Metrics to Track
- Lock acquisition success rate
- Average lock hold time
- State transition frequency by type
- Failed transitions (invalid state)
- Lock extension frequency (indicates slow RPCs)

### Alerting Triggers
- Lock hold time > 120 seconds (leaked lock)
- Failed transition rate > 5%
- Refund rate > 10% (indicates systemic RPC failures)

## Migration Path

1. **Phase 1**: Deploy `EscrowLockManager` without enforcing (shadow mode)
2. **Phase 2**: Add state tracking to Redis alongside DB state
3. **Phase 3**: Enable state machine validation (reject invalid transitions)
4. **Phase 4**: Migrate `confirm-deposit` to use `withLock` pattern
5. **Phase 5**: Remove old locking code

## Failure Scenarios

### Scenario 1: Redis Unavailable
- Lock acquisition fails open (returns `acquired: false`)
- Caller should fall back to DB-level checks
- Log warning for ops investigation

### Scenario 2: RPC Timeout
- `extendLock()` called before timeout
- State transitioned to `refund_pending`
- Refund executed under lock protection
- Final state: `refunded`

### Scenario 3: Process Crash Mid-Operation
- Lock auto-expires after TTL (60s default)
- Reconciliation sweeper detects stuck order
- Re-acquires lock and completes or refunds

## Related Issues
- #11224 - Race condition in deposit confirmation
- #8445 - Escrow release gating
- #7340 - Escrow funding reconciliation
