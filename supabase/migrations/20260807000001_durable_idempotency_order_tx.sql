-- Migration: Add durable idempotency table and restore create_order_tx RPC
--
-- The previous revision of this migration replaced create_order_tx with an
-- incompatible JSONB signature (p_idempotency_key / p_order_data /
-- p_timeline_data / p_load_offer_data) whose body referenced columns that do
-- not exist (orders.display_id, pickup_location, dropoff_location,
-- accepted_bid_amount) and a table that does not exist (order_timelines).
-- The only caller — orderCreationService — still invokes the original
-- 30-parameter signature, so order creation failed end-to-end.
--
-- Restore create_order_tx to the original signature and body against the real
-- schema (orders.order_display_id / pickup_address / drop_address,
-- order_timeline), keeping the order_idempotency_records table as the
-- foundation for future durable-idempotency wiring.

CREATE TABLE IF NOT EXISTS order_idempotency_records (
    idempotency_key VARCHAR(255) PRIMARY KEY,
    status VARCHAR(50) NOT NULL DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
    order_id UUID,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_idempotency_status ON order_idempotency_records(status);

-- The idempotency records hold per-tenant order data and must not be
-- reachable over REST. Every tenant table in this repo is RLS-protected;
-- this one was created without RLS, leaving it world-readable/writable and
-- allowing cross-tenant key enumeration and replay poisoning. Restrict it to
-- backend-only (service_role) access so the arbitration RPC stays the sole
-- authority on idempotency state.
ALTER TABLE order_idempotency_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only" ON order_idempotency_records
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON order_idempotency_records FROM anon, authenticated;

-- Extend or replace create_order_tx RPC for single atomic database transaction
CREATE OR REPLACE FUNCTION create_order_tx(
  p_idempotency_key TEXT,
  p_order_display_id TEXT,
  p_customer_id UUID,
  p_customer_name TEXT,
  p_pickup_address TEXT,
  p_pickup_lat NUMERIC,
  p_pickup_lng NUMERIC,
  p_drop_address TEXT,
  p_drop_lat NUMERIC,
  p_drop_lng NUMERIC,
  p_pickup_date TEXT,
  p_pickup_time TEXT,
  p_goods_type TEXT,
  p_weight_tonnes NUMERIC,
  p_length_ft NUMERIC,
  p_width_ft NUMERIC,
  p_height_ft NUMERIC,
  p_is_stackable BOOLEAN,
  p_is_fragile BOOLEAN,
  p_special_requirements TEXT,
  p_base_freight NUMERIC,
  p_toll_estimate NUMERIC,
  p_platform_fee NUMERIC,
  p_total_amount NUMERIC,
  p_estimated_price NUMERIC,
  p_payment_method_id TEXT,
  p_upi_id TEXT,
  p_route_label TEXT,
  p_route_subtitle TEXT,
  p_weight_text TEXT,
  p_fuel_cost NUMERIC,
  p_net_profit NUMERIC,
  p_extra_distance_km NUMERIC
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_status TEXT;
  v_created_at TIMESTAMPTZ;
  v_customer_id UUID;
  v_existing_order_id UUID;
BEGIN
  -- Resolve the customer identity: only the service-role backend may supply a
  -- p_customer_id. Any other caller is bound to their own JWT-derived profile
  -- id (get_profile_id maps the Firebase JWT sub to profiles.id), so clients
  -- can never create orders or load offers as another customer.
  IF auth.role() = 'service_role' THEN
    v_customer_id := p_customer_id;
  ELSE
    v_customer_id := get_profile_id();
    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: could not resolve caller profile';
    END IF;
    IF p_customer_id IS NOT NULL AND p_customer_id <> v_customer_id THEN
      RAISE EXCEPTION 'Unauthorized: cannot create orders as another customer';
    END IF;
  END IF;

  -- Durable idempotency: consult the order_idempotency_records table created
  -- by this migration. If a prior attempt already completed for this key,
  -- return that order instead of creating a duplicate order + timeline +
  -- load offer (which would corrupt marketplace state / double-charge escrow).
  SELECT order_id INTO v_existing_order_id
  FROM order_idempotency_records
  WHERE idempotency_key = p_idempotency_key
    AND order_id IS NOT NULL;

  IF v_existing_order_id IS NOT NULL THEN
    SELECT id, status, created_at
      INTO v_order_id, v_status, v_created_at
    FROM orders
    WHERE id = v_existing_order_id;
    RETURN json_build_object(
      'id', v_order_id,
      'order_display_id', p_order_display_id,
      'status', v_status,
      'created_at', v_created_at
    );
  END IF;

  -- Reserve this key so a concurrent or retried call short-circuits above
  -- instead of inserting a fresh order.
  INSERT INTO order_idempotency_records (idempotency_key, status, order_id)
  VALUES (p_idempotency_key, 'in_progress', NULL)
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- 1. Insert into orders
  INSERT INTO orders (
    order_display_id, customer_id, status,
    pickup_address, pickup_lat, pickup_lng,
    drop_address, drop_lat, drop_lng,
    pickup_date, pickup_time,
    goods_type, weight_tonnes, length_ft, width_ft, height_ft,
    is_stackable, is_fragile, special_requirements,
    base_freight, toll_estimate, platform_fee, total_amount, estimated_price,
    payment_method_id, upi_id
  ) VALUES (
    p_order_display_id, v_customer_id, 'pending',
    p_pickup_address, p_pickup_lat, p_pickup_lng,
    p_drop_address, p_drop_lat, p_drop_lng,
    p_pickup_date, p_pickup_time,
    p_goods_type, p_weight_tonnes, p_length_ft, p_width_ft, p_height_ft,
    p_is_stackable, p_is_fragile, p_special_requirements,
    p_base_freight, p_toll_estimate, p_platform_fee, p_total_amount, p_estimated_price,
    p_payment_method_id, p_upi_id
  ) RETURNING id, status, created_at INTO v_order_id, v_status, v_created_at;

  -- 2. Insert into order_timeline
  INSERT INTO order_timeline (order_display_id, milestone, milestone_time, completed, sort_order)
  VALUES 
    (p_order_display_id, 'Order Placed', NOW(), true, 10),
    (p_order_display_id, 'Truck Assigned', null, false, 20),
    (p_order_display_id, 'En Route to Pickup', null, false, 30),
    (p_order_display_id, 'Arrived at Pickup', null, false, 35),
    (p_order_display_id, 'Goods Loaded', null, false, 40),
    (p_order_display_id, 'In Transit', null, false, 50),
    (p_order_display_id, 'Arriving', null, false, 55),
    (p_order_display_id, 'Delivered', null, false, 60);

  -- 3. Insert into load_offers
  INSERT INTO load_offers (
    order_display_id, customer_id, customer_name,
    route_label, route_subtitle,
    pickup_address, pickup_lat, pickup_lng,
    drop_address, drop_lat, drop_lng,
    goods_type, weight,
    freight_value, fuel_cost, toll_cost, net_profit, extra_distance_km,
    status
  ) VALUES (
    p_order_display_id, v_customer_id, p_customer_name,
    p_route_label, p_route_subtitle,
    p_pickup_address, p_pickup_lat, p_pickup_lng,
    p_drop_address, p_drop_lat, p_drop_lng,
    p_goods_type, p_weight_text,
    p_total_amount, p_fuel_cost, p_toll_estimate, p_net_profit, p_extra_distance_km,
      'available'
  );

  -- Record durable idempotency completion so any retry with the same key
  -- short-circuits and returns this order instead of duplicating it.
  UPDATE order_idempotency_records
  SET status = 'completed', order_id = v_order_id, updated_at = NOW()
  WHERE idempotency_key = p_idempotency_key;

  RETURN json_build_object(
    'id', v_order_id,
    'order_display_id', p_order_display_id,
    'status', v_status,
    'created_at', v_created_at
  );
END;
$$;
