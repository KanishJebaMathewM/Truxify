CREATE OR REPLACE FUNCTION update_order_and_load_offer(
  p_order_id UUID,
  p_order_display_id TEXT,
  p_order_updates JSONB,
  p_offer_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_order JSONB;
BEGIN
  -- Update orders table based on JSONB keys
  UPDATE orders
  SET
    drop_address = COALESCE(p_order_updates->>'drop_address', drop_address),
    drop_lat = COALESCE((p_order_updates->>'drop_lat')::NUMERIC, drop_lat),
    drop_lng = COALESCE((p_order_updates->>'drop_lng')::NUMERIC, drop_lng),
    base_freight = COALESCE((p_order_updates->>'base_freight')::NUMERIC, base_freight),
    toll_estimate = COALESCE((p_order_updates->>'toll_estimate')::NUMERIC, toll_estimate),
    platform_fee = COALESCE((p_order_updates->>'platform_fee')::NUMERIC, platform_fee),
    total_amount = COALESCE((p_order_updates->>'total_amount')::NUMERIC, total_amount),
    updated_at = COALESCE((p_order_updates->>'updated_at')::TIMESTAMPTZ, updated_at)
  WHERE id = p_order_id
  RETURNING row_to_json(orders.*) INTO v_updated_order;

  -- Update load_offers table
  UPDATE load_offers
  SET
    drop_address = COALESCE(p_offer_updates->>'drop_address', drop_address),
    drop_lat = COALESCE((p_offer_updates->>'drop_lat')::NUMERIC, drop_lat),
    drop_lng = COALESCE((p_offer_updates->>'drop_lng')::NUMERIC, drop_lng),
    route_label = COALESCE(p_offer_updates->>'route_label', route_label),
    freight_value = COALESCE((p_offer_updates->>'freight_value')::NUMERIC, freight_value),
    fuel_cost = COALESCE((p_offer_updates->>'fuel_cost')::NUMERIC, fuel_cost),
    toll_cost = COALESCE((p_offer_updates->>'toll_cost')::NUMERIC, toll_cost),
    net_profit = COALESCE((p_offer_updates->>'net_profit')::NUMERIC, net_profit),
    extra_distance_km = COALESCE((p_offer_updates->>'extra_distance_km')::NUMERIC, extra_distance_km)
  WHERE order_display_id = p_order_display_id;

  RETURN v_updated_order;
END;
$$;
