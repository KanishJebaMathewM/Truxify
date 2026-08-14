-- =============================================================================
-- Migration: Restrict client writes to escrow financial/tx columns (Issue #5826)
-- =============================================================================
-- Problem:
--   The 20260802040000 migration (Issue #5726) revoked client UPDATE on
--   escrow_status / pending_bid_acceptance / total_amount / etc., but left the
--   deposit-verification and transaction-hash columns writable by
--   anon/authenticated. An attacker could PATCH:
--     - escrow_amount_wei  → re-anchor the amount the deposit is verified
--                            against (accepted bid X, deposit Y ≠ X)
--     - deposit_tx_hash / escrow_tx_hash / release_tx_hash / refund_tx_hash
--       and the escrow_*_at timestamps → forge "already funded/released"
--       evidence or desync the reconciliation workers
--
-- Fix:
--   REVOKE UPDATE on the remaining escrow financial/tx columns from
--   anon/authenticated so direct REST writes to those columns are rejected at
--   the privilege level. Backend writes are unaffected: service_role
--   (supabaseAdmin) retains UPDATE, and SECURITY DEFINER RPCs run with the
--   function owner's privileges.
--
-- Backward compatibility:
--   - Column names are checked against information_schema before each REVOKE,
--     so the migration succeeds even if a column does not yet exist.
--   - This migration is purely additive (REVOKE), so it cannot break existing
--     rows or the backend's own write paths.
-- =============================================================================

DO $$
DECLARE
  v_col TEXT;
BEGIN
  FOREACH v_col IN ARRAY ARRAY[
    'escrow_amount_wei',
    'deposit_tx_hash',
    'escrow_tx_hash',
    'escrow_deposited_at',
    'escrow_released_at',
    'escrow_refunded_at',
    'release_tx_hash',
    'refund_tx_hash'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'orders'
        AND column_name  = v_col
    ) THEN
      EXECUTE format('REVOKE UPDATE (%I) ON public.orders FROM anon, authenticated', v_col);
    END IF;
  END LOOP;
END;
$$;
