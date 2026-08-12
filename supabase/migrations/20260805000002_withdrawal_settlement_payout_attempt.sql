-- =============================================================================
-- Withdrawal settlement: payout-attempt tracking (Issue #6274)
-- -----------------------------------------------------------------------------
-- Problem:
--   The settlement worker dispatched the payout first and then marked the
--   withdrawal completed via settle_withdrawal_tx. If settle_withdrawal_tx
--   failed (transient Supabase/network error, RPC timeout), the worker's catch
--   called fail_withdrawal_tx, which restores the withdrawn amount to
--   wallet_confirmed. Because the payout had ALREADY been dispatched, the
--   driver received the bank/UPI payout AND got the amount restored to
--   wallet_confirmed — an unlimited double-payout loop.
--
-- Fix:
--   Track when a payout was actually dispatched (payout_attempted_at) so the
--   worker can distinguish:
--     - dispatch failed before money left the platform  -> safe to restore funds
--     - dispatch succeeded but completion RPC failed     -> never restore funds;
--       keep the row pending (payout_attempted_at set) so the next sweep detects
--       it and retries settle_withdrawal_tx (idempotent, matches only pending
--       rows) instead of failing the withdrawal.
-- =============================================================================

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS payout_attempted_at timestamptz;

-- Pending-withdrawal sweep now also targets rows whose payout was dispatched
-- but never settled (crash between dispatch and settle), so the existing
-- partial index covers the payout-attempted-but-unsettled rows as well.
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_payout_attempted_unsettled
  ON wallet_transactions (payout_attempted_at)
  WHERE txn_type = 'withdrawal'
    AND status = 'pending'
    AND settled_at IS NULL
    AND payout_attempted_at IS NOT NULL;
