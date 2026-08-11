-- =============================================================================
-- Migration: Restrict direct REST writes to financial/state columns (Issue #5726)
-- =============================================================================
-- Problem:
--   The client RLS policies on `orders` and `driver_details`
--   (20240101000000_rls.sql) are `FOR ALL ... WITH CHECK (ownership_column = ...)`.
--   The WITH CHECK only restricts WHOSE rows a client may touch, not WHICH
--   columns. Because get_profile_id() maps the JWT sub to profiles.id, any
--   authenticated customer/driver can PATCH /rest/v1/orders?... or
--   /rest/v1/driver_details?... and rewrite monetary/state fields that every
--   RPC and reconciliation worker treats as trusted (escrow_status, status,
--   driver_id, total_amount, wallet_* ...). Concrete abuse:
--     - setting escrow_status='funded' with no on-chain booking permanently
--       blocks the driver payout (complete_trip_tx raise + release worker
--       can never release a non-existent booking)
--     - setting status='payment_released' makes complete_trip_tx early-return
--       without crediting the driver's wallet
--     - rewriting driver_id/truck_number/driver_name desyncs the order from
--       the driver captured in escrow_driver_wallet at accept time, and
--       rewriting total_amount feeds the payout COALESCE in complete_trip_tx
--
-- Fix:
--   1. REVOKE UPDATE on the protected columns from anon/authenticated so
--      direct REST writes to those columns are rejected at the privilege
--      level. This matches the existing precedent for the driver wallet
--      columns (REVOKE UPDATE in the #5723 migration) and cannot affect
--      backend writes: service_role (supabaseAdmin) retains UPDATE, and
--      SECURITY DEFINER RPCs run with the function owner's privileges, which
--      are not affected by revoking from anon/authenticated.
--   2. Narrow the client policies on orders/driver_details from `FOR ALL` to
--      ownership-scoped SELECT + INSERT + UPDATE (removing client DELETE).
--      Column-level restriction is enforced by the REVOKEs above; a BEFORE
--      UPDATE trigger is intentionally NOT used because a trigger gated on
--      current_role would break SECURITY DEFINER RPCs (they run as the
--      function owner) and one gated on auth.role() would break RPCs invoked
--      with a user JWT (e.g. confirm-deposit -> accept_bid_tx).
--
-- Backward compatibility:
--   - Column names are checked against information_schema before each REVOKE,
--     so the migration succeeds even if a column does not yet exist (several
--     escrow columns are only added by other migrations).
--   - Ownership-based SELECT/INSERT/UPDATE behaviour is unchanged.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Revoke UPDATE on protected orders columns from client roles
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_col TEXT;
BEGIN
  FOREACH v_col IN ARRAY ARRAY[
    'status',
    'escrow_status',
    'escrow_disabled',
    'escrow_booking_id',
    'escrow_driver_wallet',
    'pending_bid_acceptance',
    'escrow_funding_started_at',
    'escrow_funding_attempts',
    'escrow_funding_last_attempt_at',
    'escrow_funding_error',
    'escrow_refund_error',
    'escrow_refund_attempts',
    'escrow_refund_last_attempt_at',
    'escrow_refund_submitted_at',
    'escrow_release_error',
    'escrow_release_attempts',
    'escrow_release_last_attempt_at',
    'driver_id',
    'driver_name',
    'driver_rating',
    'truck_number',
    'base_freight',
    'toll_estimate',
    'platform_fee',
    'total_amount',
    'cancellation_fee',
    'blockchain_tx_hash',
    'delivery_otp',
    'otp_verified',
    'otp_generated_at'
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Revoke UPDATE on protected driver_details columns from client roles
--    (wallet_* are already revoked by the #5723 migration; the rest are
--    backend-computed or payout-relevant)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_col TEXT;
BEGIN
  FOREACH v_col IN ARRAY ARRAY[
    'wallet_confirmed',
    'wallet_pending',
    'wallet_total',
    'wallet_withdrawn',
    'wallet_locked',
    'rating',
    'total_trips',
    'completion_rate'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'driver_details'
        AND column_name  = v_col
    ) THEN
      EXECUTE format('REVOKE UPDATE (%I) ON public.driver_details FROM anon, authenticated', v_col);
    END IF;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Narrow the client policies on orders: keep ownership-scoped
--    SELECT/INSERT/UPDATE, remove client DELETE.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Customers access own orders" ON public.orders;

CREATE POLICY "Customers select own orders"
  ON public.orders FOR SELECT TO authenticated
  USING (customer_id = get_profile_id());

CREATE POLICY "Customers insert own orders"
  ON public.orders FOR INSERT TO authenticated
  WITH CHECK (customer_id = get_profile_id());

CREATE POLICY "Customers update own orders"
  ON public.orders FOR UPDATE TO authenticated
  USING (customer_id = get_profile_id())
  WITH CHECK (customer_id = get_profile_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Narrow the client policies on driver_details: keep ownership-scoped
--    SELECT/INSERT/UPDATE, remove client DELETE.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Drivers access own driver_details" ON public.driver_details;

CREATE POLICY "Drivers select own driver_details"
  ON public.driver_details FOR SELECT TO authenticated
  USING (user_id = get_profile_id());

CREATE POLICY "Drivers insert own driver_details"
  ON public.driver_details FOR INSERT TO authenticated
  WITH CHECK (user_id = get_profile_id());

CREATE POLICY "Drivers update own driver_details"
  ON public.driver_details FOR UPDATE TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());
