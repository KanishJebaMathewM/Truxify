# Phase 2 — Escrow Release & Trip Completion: Failure-Safe Architecture Report

Issue: [CRITICAL] Make Escrow Release and Trip Completion Failure-Safe with Automated Reconciliation
Branch: `fix/escrow-release-reconciliation`
Date: 2026-08-07

This document is the Phase 2 architecture report. It documents the current flows,
the exact failure window, and the files to modify. It must be approved before any
code changes are made.

> Note: the codebase has moved beyond the issue text. Several parts the issue asks
> to "activate" or "add" already exist (reconciler is started in `index.js`,
> release-before-finalize ordering exists, an order-scoped Redis lock exists). The
> real defects are: (1) two escrow exports were removed in commit `6a15bf5a` and
> now crash server startup, (2) release-evidence persistence goes through the anon
> client which RLS/column-revoke makes a silent no-op, (3) the reconciliation
> worker's target state (`release_failed`) is never written, so it is inert, and
> (4) the worker only fixes `escrow_status`, never finalizes the trip or credits
> the wallet.

---

## (a) Current successful delivery flow

Entry: `POST /api/deliveries/:id/confirm-otp` (alias of `/:id/verify-delivery`),
`backend/api/src/routes/orderRoutes.js:248`.

1. Middleware: `authenticate`, `userLimiter`, `requirePolicy('delivery:verify')`,
   `auditLog`, `verifyDeliveryLimiter`, `requireIdempotency(86400)`, param/body
   validation.
2. `orderLifecycleService.verifyDeliveryFn` acquires the order-scoped lock
   `escrow_lock:<orderId>` (TTL 120 s) via `acquireLock` (`redisLock.js`), then
   calls `deliveryVerification.verifyDelivery`.
3. `DeliveryVerificationService.verifyDelivery` (`deliveryVerificationService.js:449`):
   - `validateDeliveryOtp`: OTP lockout check, order fetch, driver assignment check,
     status must be `arriving` (or a stuck-escrow retry).
   - Geofence assertion via server-ingested telemetry (skipped for stuck-escrow retries).
   - If `escrow_status IN ('funded','release_failed')`: call `escrowRelease`; on
     success, **best-effort** persist `escrow_status='released'`, `release_tx_hash`,
     `escrow_released_at` (lines 504–519, log-only on failure), then call
     `complete_trip_tx` RPC (service_role) with `p_release_tx_hash`.
   - If `escrow_status='released'` (previous attempt): reuse persisted hash, skip chain.
   - Post-RPC: verify `status='payment_released'`, complete the OTP, revoke tracking
     tokens, send FCM push.
4. On `escrowUpdateFailed` the route returns 202 with
   `escrow_status:'release_pending_reconciliation'`.

## (b) Blockchain release flow

`escrowRelease(orderDisplayId)` (`backend/api/src/services/escrow.js:367`):

- Derives `bookingId = keccak256("escrow:" + orderDisplayId)`.
- If `escrowContract` is uninitialised (env vars missing) → returns
  `{ txHash: null, bookingId }` (no error — silently "succeeds" without releasing).
- Reads `bookings(bookingId)`; if `booking.paid === true` → returns
  `{ txHash: null, bookingId, alreadyReleased: true }` (no tx hash is captured).
- Else submits `releasePayment(bookingId)`, waits 1 confirmation, returns
  `{ txHash: receipt.hash, bookingId }` or `{ txHash: null, bookingId, error }`.

## (c) DB finalization flow

`complete_trip_tx` (latest authoritative: `supabase/migrations/20260805120000_secure_complete_trip_tx_auth.sql`):

- `SELECT ... FOR UPDATE` on the order row (serializes concurrent calls).
- Auth guard: only `service_role` or the assigned driver (via `get_profile_id()`).
- Idempotency: if `status = 'payment_released'` → return immediately (no re-credit).
- Validates the OTP row (`delivery_otps`, `verified=false`, unexpired).
- Rejects `cancelled` / `delivered`.
- Fail-closed escrow gate:
  `IF NOT escrow_disabled AND coalesce(escrow_status,'') <> 'released' AND p_release_tx_hash IS NULL THEN raise`.
- Finalizes the active trip linked to the order (trips/trip_items/trip_stops).
- Sets `status='payment_released'`, `escrow_status='released'`, `escrow_released_at`,
  `blockchain_tx_hash = coalesce(p_release_tx_hash, ...)`.
- Credits the driver wallet exactly once: `driver_details` totals increment,
  `wallet_transactions` INSERT (`credit`/`confirmed`), `earnings_daily` upsert.
  Exactly-once is enforced by the `FOR UPDATE` row lock + `payment_released` early
  return; there is **no** unique constraint on `wallet_transactions(order_display_id, txn_type)`.

## (d) Existing escrow states

Written/read by app code today:

| State | Written by | Read by |
|---|---|---|
| `funding` | accept-bid / confirm-deposit path | funding reconciler, change-drop guard |
| `funded` | `confirmDeposit` | verify-delivery, webhook, cancel |
| `release_failed` | **nobody (dead state)** | release reconciler query, verify-delivery, webhook |
| `released` | verify-delivery, RPC, webhook, release reconciler | verify-delivery retry |
| `refund_pending` / `refund_failed` / `refunded` | cancel flow | refund reconciler, webhook |
| `pending` | revert path | — |

Critical finding: **`escrow_status = 'release_failed'` is never written anywhere**
in `backend/api/src`. The release reconciliation worker selects only
`.eq('escrow_status', 'release_failed')`, so it currently processes zero rows.

## (e) Reconciliation infrastructure

- `escrowReleaseReconciliation.js` — `reconcilePendingEscrowReleases()`:
  - Global Redis lock `escrow:release:reconciliation:lock` via raw
    `redisClient.set(key, process.pid, 'NX', 'EX', 120)` (no owner token on release;
    plain `del`).
  - Selects `release_failed` orders with `escrow_release_attempts < 10` (limit 50).
  - Claims each via `claim_release_reconciliation` RPC
    (`20260703000000_add_claim_release_reconciliation.sql`) which bumps
    `escrow_release_attempts`/`escrow_release_last_attempt_at`, sets
    `reconciled_by`/`reconciled_at`, guarded on `escrow_status='release_failed' AND
    reconciled_by IS NULL`.
  - On chain release success: sets `escrow_status='released'`, persists hash, clears
    `reconciled_by`. **Does NOT call `complete_trip_tx`** — the trip is never
    finalized and the wallet is never credited by the worker.
  - On failure: bumps attempts, writes error, clears `reconciled_by`.
- Started at `index.js:669`; stopped on shutdown (`index.js:710`).
- Sibling workers (`escrowRefundReconciliation`, `escrowFundingReconciliation`)
  follow the same shape; the funding worker additionally takes the per-order lock
  `escrow_lock:<order.id>` (30 s) and uses `acquireLock`/`releaseLock`.

## (f) Distributed lock infrastructure

`backend/api/src/lib/redisLock.js`:

- `acquireLock(key, ttlMs=30_000)` → UUID owner token; `null` if held;
  throws `LockAcquisitionError` when Redis is down (fail closed).
- `releaseLock(key, token)` → Lua `GET==token THEN DEL`, never throws.
- `renewLock(key, token, ttlMs)` → Lua `PEXPIRE` guarded by ownership.
- `verifyDeliveryFn` (`orderLifecycleService.js:487`) already uses
  `escrow_lock:<orderId>` (120 s). `changeDrop`/`cancelOrder`/`confirmDeposit` also
  use `escrow_lock:<orderId>` (30 s).

## (g) Exact failure window

Scenario: driver confirms OTP → chain release succeeds → `complete_trip_tx` fails
(DB outage, transient RPC error, timeout after commit).

State after failure: order `status='arriving'`, `escrow_status='funded'` (or
`released` if the best-effort persist happened to work), `release_tx_hash=null`.

Why today's code does not recover:

1. The best-effort persist before the RPC (`deliveryVerificationService.js:504–519`)
   uses the container `orderRepository`, built on the **anon** client
   (`container.js:25`, `db.js:33`). Under RLS (`20240101000000_rls.sql:165`) anon has
   **no** policy on `orders`, and `escrow_status`/`escrow_release_*` are
   **REVOKE UPDATE** from anon/authenticated (`20260802040000_restrict_financial_column_writes.sql`).
   The persist is therefore a silent no-op in production; only the service_role RPC
   actually records release evidence.
2. On driver retry, `escrowRelease` returns `{ alreadyReleased: true }` with no tx
   hash → `p_release_tx_hash` stays `null` → the RPC's fail-closed gate
   (`escrow_status <> 'released' AND p_release_tx_hash IS NULL`) raises → order is
   permanently stuck (`arriving`, `funded`, no hash).
3. The reconciler only selects `release_failed` (never written) → never heals it.
4. The only remaining healer is the `PaymentReleased` webhook
   (`escrowWebhookProcessor.js:71`), which requires the relayer to emit webhooks and
   `WEBHOOK_SECRET` to be configured — not guaranteed.

Secondary defect: the reconciler, when it does run, sets `escrow_status='released'`
but never runs `complete_trip_tx`, so a driver whose order is in `release_failed`
with `status <> 'payment_released'` would be left unpaid.

Additional startup defect: `backend/api/src/services/escrow.js` no longer exports
`getEscrowBooking` (imported by `escrowFundingReconciliation.js:3`) or
`markEscrowBookingStarted` (imported by `orderMilestoneService.js:20`). Commit
`6a15bf5a` removed them while their consumers remain, so
`node -e "import('./backend/api/src/services/escrowFundingReconciliation.js')"`
throws `SyntaxError: ... does not provide an export named ...`. Since `index.js`
imports both modules (lines 125–128 via container and directly), **the API server
currently fails to start**. Verified by direct import probes.

## (h) Exact files to modify

Backend (Node):
1. `backend/api/src/services/escrow.js` — re-add `getEscrowBooking(bookingId)`
   (read `bookings()` and return the booking or null) and
   `markEscrowBookingStarted(orderDisplayId)` (submit `markBookingStarted`, return
   `{ txHash, bookingId, waitForConfirmation }`, matching the existing
   submit-style functions). Restores startup.
2. `backend/api/src/core/container.js` — remove the duplicate
   `submitEscrowRefund` import/export.
3. `backend/api/src/services/order/deliveryVerificationService.js` — persist release
   evidence (escrow_status/release_tx_hash/escrow_released_at) via a **service_role**
   client (new `OrderRepository(supabaseAdmin)`), not the anon container repository;
   keep it before `complete_trip_tx`.
4. `backend/api/src/services/escrowReleaseReconciliation.js` — rework:
   - Sweep `release_failed` AND `funded`/`released` orders whose trip is not finalized
     (`status <> 'payment_released'`) or that lack release evidence.
   - Use `acquireLock`/`releaseLock`/`renewLock` (UUID ownership) for the global lock
     and the per-order `escrow_lock:<order.id>`.
   - After confirming on-chain release, persist evidence and call `complete_trip_tx`
     (service_role) to finalize the trip and credit the wallet exactly once.
5. `backend/api/src/repositories/orderRepository.js` — add a `findPendingEscrowReleases`
   helper (select order id/display id/hash/attempts/status) and a service-role
   `completeTrip` wrapper if not already covered by `executeRpc(..., supabaseAdmin)`.
6. `backend/api/src/services/order/orderMilestoneService.js` — dead `verifyDelivery`
   (unused by any route; grep-verified) remains importable once the export is
   restored; optionally mark deprecated, no behavior change required.
7. `backend/api/src/services/escrowFundingReconciliation.js` — only the missing
   `getEscrowBooking` export blocks it; no logic change needed beyond the import fix.

Schema (SQL) — only if required; do not invent columns:
8. Optionally harden exactly-once wallet credit with a unique index on
   `wallet_transactions(order_display_id, txn_type)` after de-duplicating existing
   rows (must be a separate, backfill-safe migration). The RPC-level guarantee
   already holds; this is defense in depth.

Tests:
9. `backend/api/test/` — unit tests for the reworked reconciler (claim → release →
   finalize), for `verifyDelivery` release-evidence persistence via service_role,
   and contract tests asserting `complete_trip_tx` remains exactly-once
   (`contracts/delivery.contract.test.js` already has a `completeTripRpcError`
   injection hook to extend).

## Approval gate

No code has been changed yet (only this report was written). Awaiting approval to
proceed with Phase 3+ implementation.
