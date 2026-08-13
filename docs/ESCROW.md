# Escrow Service

## Overview

The Truxify backend escrows customer payments on the Polygon blockchain (`services/escrow.js`). The escrow contract holds funds until delivery is verified, then releases them to the driver — with dispute and penalty paths.

---

## Location

```
backend/api/src/services/escrow.js
```

Circuit breaker:

```
backend/api/src/services/escrowCircuitBreaker.js
```

Reconciliation:

```
backend/api/src/services/escrowFundingReconciliation.js
backend/api/src/services/escrowRefundReconciliation.js
backend/api/src/services/escrowReleaseReconciliation.js
```

---

## Flow

1. **Booking** — `createBooking` records the escrow intent; `buildDepositTx` mints an owner-signed commitment binding the customer wallet, booking ID, and nonce so a third party cannot front-run a pending booking.
2. **Deposit** — the customer's wallet signs and submits the deposit transaction on-chain; the backend records the tx hash.
3. **Release** — after delivery verification, `releasePayment` pays the driver.
4. **Cancel / Dispute** — `cancelBooking`, `cancelWithPenalty`, `raiseDispute`, `resolveDispute`, and `resolveDisputeTimeout` handle the failure paths.

---

## Configuration

| Variable | Description |
|----------|-------------|
| `POLYGON_RPC_URL` | JSON-RPC endpoint |
| `ESCROW_CONTRACT_ADDRESS` | Deployed TruxifyEscrow contract |
| `RELAYER_WALLET_PRIVATE_KEY` | Relayer wallet for release/cancel |
| `ESCROW_MATIC_PER_PAISA` / `MAX_ESCROW_MATIC` | Paisa-to-MATIC conversion and caps |

---

## Safety

- **Circuit breaker** — a Redis-backed pause flag (set via the internal n8n endpoint) refuses all on-chain submissions while open; fail-open on Redis outage.
- **Reconciliation** — funding, refund, and release sweepers page through stale orders, hold per-order Redis locks, retry with exponential backoff, and escalate after `MAX_RETRIES`.
- **Amount checks** — deposits are verified against the authoritative expected amount before an order can finalize.

---

## Why It Exists

Escrow removes the trust problem in freight: the customer's money exists on-chain before the driver moves cargo, and release is triggered only by verified delivery.

---

## Testing

Automated tests verify:

- Booking/deposit/release flow functions.
- Amount mismatch and paused-circuit behavior.
- Reconciliation backoff and locking.
- Refund and release paths.
