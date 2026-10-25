-- =============================================================================
-- Migration: harden the outbox relay worker RPCs (issue #5890)
-- =============================================================================
-- Problem:
--   claim_outbox_batch and reclaim_outbox_batch are SECURITY DEFINER but were
--   executable by any authenticated client: the original migration granted
--   EXECUTE to service_role without revoking it from anon/authenticated, so a
--   client could claim relay batches (or reset in-flight leases) at will.
--
-- Fix:
--   Redefine both functions with a service_role caller assertion (mirroring
--   20260708000000_fix_rpc_security.sql) and revoke EXECUTE from PUBLIC,
--   anon and authenticated, keeping the service_role grant. Bodies are
--   otherwise byte-identical to 20260815000000_outbox_relay_claim_lock.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION claim_outbox_batch(
  p_worker_id text,
  p_batch_size integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Only the backend relay worker (service_role) may claim relay rows. Without
  -- this, any authenticated client could claim batches under an arbitrary
  -- worker id with a long lease and stall event publishing (issue #5890).
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can claim outbox relay rows';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM outbox_events
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_events o
  SET status = 'publishing',
      claimed_by = p_worker_id,
      claimed_at = now(),
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval
  FROM claimed c
  WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION reclaim_outbox_batch(
  p_lease_buffer_seconds integer DEFAULT 60,
  p_batch_size integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  reclaimed integer;
BEGIN
  -- Same service_role restriction as claim_outbox_batch above: reclaiming
  -- expired leases back to pending must stay a worker-only operation.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can reclaim outbox relay rows';
  END IF;

  WITH expired AS (
    SELECT id
    FROM outbox_events
    WHERE status = 'publishing'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < now() - (p_lease_buffer_seconds || ' seconds')::interval
    ORDER BY lease_expires_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_events o
  SET status = 'pending',
      claimed_by = NULL,
      claimed_at = NULL,
      lease_expires_at = NULL
  FROM expired e
  WHERE o.id = e.id;

  GET DIAGNOSTICS reclaimed = ROW_COUNT;
  RETURN reclaimed;
END;
$$;

-- Belt and suspenders: the role assertion above already rejects non-service
-- callers, and these REVOKEs remove the RPCs from PostgREST exposure entirely.
REVOKE ALL ON FUNCTION claim_outbox_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reclaim_outbox_batch(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_outbox_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION reclaim_outbox_batch(integer, integer) TO service_role;

-- =============================================================================
-- update_order_and_load_offer: re-assert the existing REVOKE (issue #5890)
-- =============================================================================
-- The function body below is byte-identical to 20260812000000_order_outbox.sql
-- (which already verifies the caller owns the order). The original
-- 20260802000000 REVOKE lives in a separate statement that the release gate
-- cannot see, so it is re-issued here alongside the definition it protects.
CREATE OR REPLACE FUNCTION update_order_and_load_offer(
  p_order_id UUID,
  p_order_display_id TEXT,
  p_order_updates JSONB,
  p_offer_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_order JSONB;
  v_customer_id   UUID;
BEGIN
  -- Resolve the owning customer of the order for the ownership guard.
  SELECT customer_id INTO v_customer_id
  FROM orders
  WHERE id = p_order_id;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Ownership guard: an authenticated caller may only update their own order.
  -- Access control: EXECUTE is revoked from anon/authenticated at the
  -- bottom of this migration (REVOKE EXECUTE ...); only service_role calls.
  IF auth.uid() IS NOT NULL AND get_profile_id() <> v_customer_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only update your own orders';
  END IF;

  -- Only the backend (service_role) may rewrite pricing/payout math.
  IF auth.role() <> 'service_role' THEN
    UPDATE orders
    SET
      drop_address = COALESCE(p_order_updates->>'drop_address', drop_address),
      drop_lat     = COALESCE((p_order_updates->>'drop_lat')::NUMERIC, drop_lat),
      drop_lng     = COALESCE((p_order_updates->>'drop_lng')::NUMERIC, drop_lng),
      updated_at   = COALESCE((p_order_updates->>'updated_at')::TIMESTAMPTZ, updated_at)
    WHERE id = p_order_id
    RETURNING row_to_json(orders.*) INTO v_updated_order;

    UPDATE load_offers
    SET
      drop_address     = COALESCE(p_offer_updates->>'drop_address', drop_address),
      drop_lat         = COALESCE((p_offer_updates->>'drop_lat')::NUMERIC, drop_lat),
      drop_lng         = COALESCE((p_offer_updates->>'drop_lng')::NUMERIC, drop_lng),
      route_label      = COALESCE(p_offer_updates->>'route_label', route_label),
      extra_distance_km = COALESCE((p_offer_updates->>'extra_distance_km')::NUMERIC, extra_distance_km)
    WHERE order_display_id = p_order_display_id;
  ELSE
    UPDATE orders
    SET
      drop_address  = COALESCE(p_order_updates->>'drop_address', drop_address),
      drop_lat      = COALESCE((p_order_updates->>'drop_lat')::NUMERIC, drop_lat),
      drop_lng      = COALESCE((p_order_updates->>'drop_lng')::NUMERIC, drop_lng),
      base_freight  = COALESCE((p_order_updates->>'base_freight')::NUMERIC, base_freight),
      toll_estimate = COALESCE((p_order_updates->>'toll_estimate')::NUMERIC, toll_estimate),
      platform_fee  = COALESCE((p_order_updates->>'platform_fee')::NUMERIC, platform_fee),
      total_amount  = COALESCE((p_order_updates->>'total_amount')::NUMERIC, total_amount),
      updated_at    = COALESCE((p_order_updates->>'updated_at')::TIMESTAMPTZ, updated_at)
    WHERE id = p_order_id
    RETURNING row_to_json(orders.*) INTO v_updated_order;

    UPDATE load_offers
    SET
      drop_address      = COALESCE(p_offer_updates->>'drop_address', drop_address),
      drop_lat          = COALESCE((p_offer_updates->>'drop_lat')::NUMERIC, drop_lat),
      drop_lng          = COALESCE((p_offer_updates->>'drop_lng')::NUMERIC, drop_lng),
      route_label       = COALESCE(p_offer_updates->>'route_label', route_label),
      freight_value     = COALESCE((p_offer_updates->>'freight_value')::NUMERIC, freight_value),
      fuel_cost         = COALESCE((p_offer_updates->>'fuel_cost')::NUMERIC, fuel_cost),
      toll_cost         = COALESCE((p_offer_updates->>'toll_cost')::NUMERIC, toll_cost),
      net_profit        = COALESCE((p_offer_updates->>'net_profit')::NUMERIC, net_profit),
      extra_distance_km = COALESCE((p_offer_updates->>'extra_distance_km')::NUMERIC, extra_distance_km)
    WHERE order_display_id = p_order_display_id;
  END IF;

  -- Durable outbox event, committed with the order (same transaction).
  PERFORM public.add_order_outbox_event(
    p_order_id,
    p_order_display_id,
    'ORDER_UPDATED',
    jsonb_build_object(
      'orderId',          p_order_id::text,
      'order_id',         p_order_id::text,
      'order_display_id', p_order_display_id,
      'status',           v_updated_order->>'status',
      'updates',          p_order_updates
    )
  );

  RETURN v_updated_order;
END;
$$;

-- 6d. accept_bid_tx (driver assignment)

REVOKE EXECUTE ON FUNCTION public.update_order_and_load_offer(UUID, TEXT, JSONB, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_and_load_offer(UUID, TEXT, JSONB, JSONB) TO service_role;
