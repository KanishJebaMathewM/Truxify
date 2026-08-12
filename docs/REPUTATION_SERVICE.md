# Reputation Service

## Overview

The Truxify backend awards on-chain driver reputation points on the Polygon blockchain after completed ratings (`services/reputation.js`).

---

## Location

```
backend/api/src/services/reputation.js
```

---

## Behavior

- `awardReputationPoints(driverWalletAddress, stars)` calls `increaseReputation` on the Reputation contract — 1 on-chain point per star (1-5 stars).
- `getDriverReputation(walletAddress)` reads the on-chain score with a 5 s RPC timeout.
- `clampReputation(value)` clamps a score to `[0, 10000]` to match the contract's `MAX_REPUTATION`.

### Guards

- Missing env vars (`POLYGON_RPC_URL`, `REPUTATION_CONTRACT_ADDRESS`, `RELAYER_WALLET_PRIVATE_KEY`) disable the module (exports null contract) so callers skip gracefully.
- Invalid wallet addresses and out-of-range star values are skipped with a warning.

### Reliability

- The transaction is submitted **once**; only the confirmation wait is retried (exponential backoff with jitter) so a timed-out confirmation cannot re-award points.
- The call is fire-and-forget by design — a blockchain failure never blocks the HTTP response; the Supabase RPC is the source of truth for ratings.

---

## Why It Exists

On-chain reputation makes driver quality portable and auditable, and it feeds trust-scoring and load matching. The fire-and-forget design keeps the rating endpoint fast while the retry-without-resubmit logic prevents double-awarding.

---

## Testing

Automated tests verify:

- Clamping behavior.
- Stars validation.
- Invalid-address handling.
- Retry/backoff logic.
- Disabled-module behavior without env vars.
