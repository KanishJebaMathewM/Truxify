-- =============================================================================
-- Migration: Persist escrow_amount_wei rebalance on change-drop (Issue #5825)
-- =============================================================================
-- Problem:
--   change-drop reprices the order (base_freight, toll_estimate,
--   platform_fee, total_amount) and the backend sends an escrow_amount_wei
--   matching the new total, but update_order_and_load_offer never wrote that
--   key. escrow_amount_wei is the authoritative payout figure (validated at
--   deposit-confirm time and read on release), so it drifted from the
--   displayed price: a longer drop under-paid the driver, a shorter drop
--   never refunded the difference.
--
-- Fix:
--   In the service_role branch (the only caller that may rewrite pricing),
--   persist escrow_amount_wei from p_order_updates alongside the other
--   financial columns. It is a TEXT column so it is written as text, not
--   numeric. The change-drop gate already rejects escrow_status 'funding'
--   and 'funded', so only pre-funding drops can be repriced here.
-- =============================================================================

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
  -- get_profile_id() maps the Firebase JWT sub to profiles.id, which is what
  -- orders.customer_id actually stores (auth.uid() is the Firebase UID and
  -- would never match).
  IF auth.uid() IS NOT NULL AND get_profile_id() <> v_customer_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only update your own orders';
  END IF;

  -- Only the backend (service_role) may rewrite pricing/payout math.
  -- Financial columns are server-computed and must never be supplied by a
  -- client; authenticated callers are limited to the change-drop set.
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
      escrow_amount_wei = COALESCE(p_order_updates->>'escrow_amount_wei', escrow_amount_wei),
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

  RETURN v_updated_order;
END;
$$;

-- Only the backend service may invoke this RPC; revoke direct client access.
REVOKE EXECUTE ON FUNCTION public.update_order_and_load_offer(UUID, TEXT, JSONB, JSONB) FROM anon, authenticated;
