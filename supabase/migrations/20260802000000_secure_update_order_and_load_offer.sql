-- =============================================================================
-- Migration: Harden update_order_and_load_offer RPC (Issue #5722)
-- =============================================================================
-- Problem:
--   update_order_and_load_offer was defined SECURITY DEFINER with no
--   auth.uid() ownership check, no SET search_path, and default PUBLIC
--   EXECUTE. Any authenticated (or anon) user could call it directly via
--   POST /rest/v1/rpc/update_order_and_load_offer and rewrite another
--   customer's drop location and pricing/payout fields on any order and its
--   linked load_offers row.
--
-- Fix:
--   1. Add an ownership guard: if an authenticated user invokes the function
--      directly, they may only update their own order.
--   2. Restrict writable columns: only the backend (service_role) may write
--      financial/derived fields (base_freight, toll_estimate, platform_fee,
--      total_amount on orders; freight_value, fuel_cost, toll_cost,
--      net_profit on load_offers). Authenticated callers can only change the
--      change-drop set (drop_address, drop_lat, drop_lng, route_label,
--      extra_distance_km, updated_at).
--   3. Set search_path to public, pg_temp (avoids search-path hijacking).
--   4. REVOKE EXECUTE from anon, authenticated — only service_role can call.
--      The backend is updated to invoke this RPC with the service-role client.
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
