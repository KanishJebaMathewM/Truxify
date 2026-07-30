CREATE OR REPLACE FUNCTION create_order_tx(
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
AS $$
DECLARE
  v_order_id UUID;
  v_status TEXT;
  v_created_at TIMESTAMPTZ;
BEGIN
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
    p_order_display_id, p_customer_id, 'pending',
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
    p_order_display_id, p_customer_id, p_customer_name,
    p_route_label, p_route_subtitle,
    p_pickup_address, p_pickup_lat, p_pickup_lng,
    p_drop_address, p_drop_lat, p_drop_lng,
    p_goods_type, p_weight_text,
    p_total_amount, p_fuel_cost, p_toll_estimate, p_net_profit, p_extra_distance_km,
    'available'
  );

  RETURN json_build_object(
    'id', v_order_id,
    'order_display_id', p_order_display_id,
    'status', v_status,
    'created_at', v_created_at
  );
END;
$$;
