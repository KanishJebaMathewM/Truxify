-- Migration: fix create_order_tx (durable idempotency RPC) to use the real schema
--
-- The 4-arg create_order_tx from 20260807000001 referenced fabricated columns
-- (orders.display_id / pickup_location / dropoff_location / accepted_bid_amount,
-- the non-existent order_timelines table, load_offers.order_id) and was created
-- without SECURITY DEFINER / pinned search_path / grant hardening. Replace it
-- with the real orders / order_timeline / load_offers columns, mirroring the
-- insert lists used by the 32-arg create_order_tx RPC.

CREATE OR REPLACE FUNCTION create_order_tx(
    p_idempotency_key TEXT,
    p_order_data JSONB,
    p_timeline_data JSONB,
    p_load_offer_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_record RECORD;
    v_order_id UUID;
    v_status TEXT;
    v_customer_id UUID;
    v_result JSONB;
    v_timeline JSONB;
BEGIN
    -- 1. Check existing durable idempotency record
    SELECT * INTO v_existing_record
    FROM order_idempotency_records
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_record.status = 'completed' THEN
            RETURN v_existing_record.response_body;
        ELSIF v_existing_record.status = 'in_progress' AND v_existing_record.created_at > (NOW() - INTERVAL '5 minutes') THEN
            RAISE EXCEPTION 'ORDER_CREATION_IN_PROGRESS' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 2. Upsert in_progress status lock in DB
    INSERT INTO order_idempotency_records (idempotency_key, status, updated_at)
    VALUES (p_idempotency_key, 'in_progress', NOW())
    ON CONFLICT (idempotency_key)
    DO UPDATE SET status = 'in_progress', updated_at = NOW();

    -- Resolve the customer identity: only the service-role backend may supply a
    -- customer_id. Any other caller is bound to their own JWT-derived profile id.
    IF auth.role() = 'service_role' THEN
        v_customer_id := (p_order_data->>'customer_id')::UUID;
    ELSE
        v_customer_id := get_profile_id();
        IF v_customer_id IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: could not resolve caller profile';
        END IF;
        IF (p_order_data->>'customer_id') IS NOT NULL AND (p_order_data->>'customer_id')::UUID <> v_customer_id THEN
            RAISE EXCEPTION 'Unauthorized: cannot create orders as another customer';
        END IF;
    END IF;

    -- 3. Perform atomic Order Creation
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
        p_order_data->>'order_display_id',
        v_customer_id,
        COALESCE(p_order_data->>'status', 'pending'),
        p_order_data->>'pickup_address',
        (p_order_data->>'pickup_lat')::DOUBLE PRECISION,
        (p_order_data->>'pickup_lng')::DOUBLE PRECISION,
        p_order_data->>'drop_address',
        (p_order_data->>'drop_lat')::DOUBLE PRECISION,
        (p_order_data->>'drop_lng')::DOUBLE PRECISION,
        (p_order_data->>'pickup_date')::DATE,
        (p_order_data->>'pickup_time')::TIME,
        p_order_data->>'goods_type',
        (p_order_data->>'weight_tonnes')::NUMERIC,
        (p_order_data->>'length_ft')::NUMERIC,
        (p_order_data->>'width_ft')::NUMERIC,
        (p_order_data->>'height_ft')::NUMERIC,
        COALESCE((p_order_data->>'is_stackable')::BOOLEAN, false),
        COALESCE((p_order_data->>'is_fragile')::BOOLEAN, false),
        CASE WHEN jsonb_typeof(p_order_data->'special_requirements') = 'array'
             THEN (p_order_data->'special_requirements')::TEXT[]
             ELSE NULL END,
        (p_order_data->>'base_freight')::INTEGER,
        (p_order_data->>'toll_estimate')::INTEGER,
        (p_order_data->>'platform_fee')::INTEGER,
        (p_order_data->>'total_amount')::INTEGER,
        (p_order_data->>'estimated_price')::INTEGER,
        (p_order_data->>'payment_method_id')::UUID,
        p_order_data->>'upi_id'
    )
    RETURNING id, status INTO v_order_id, v_status;

    -- 4. Insert Order Timeline milestones
    IF p_timeline_data IS NULL OR jsonb_typeof(p_timeline_data) <> 'array' OR jsonb_array_length(p_timeline_data) = 0 THEN
        INSERT INTO order_timeline (order_display_id, milestone, milestone_time, completed, sort_order)
        VALUES
            (p_order_data->>'order_display_id', 'Order Placed', NOW(), true, 10),
            (p_order_data->>'order_display_id', 'Truck Assigned', NULL, false, 20),
            (p_order_data->>'order_display_id', 'En Route to Pickup', NULL, false, 30),
            (p_order_data->>'order_display_id', 'Arrived at Pickup', NULL, false, 35),
            (p_order_data->>'order_display_id', 'Goods Loaded', NULL, false, 40),
            (p_order_data->>'order_display_id', 'In Transit', NULL, false, 50),
            (p_order_data->>'order_display_id', 'Arriving', NULL, false, 55),
            (p_order_data->>'order_display_id', 'Delivered', NULL, false, 60);
    ELSE
        FOR v_timeline IN SELECT value FROM jsonb_array_elements(p_timeline_data)
        LOOP
            INSERT INTO order_timeline (order_display_id, milestone, milestone_time, completed, sort_order)
            VALUES (
                p_order_data->>'order_display_id',
                v_timeline->>'milestone',
                (v_timeline->>'milestone_time')::TIMESTAMPTZ,
                COALESCE((v_timeline->>'completed')::BOOLEAN, false),
                COALESCE((v_timeline->>'sort_order')::INTEGER, 0)
            );
        END LOOP;
    END IF;

    -- 5. Insert Load Offer record if present
    IF p_load_offer_data IS NOT NULL AND p_load_offer_data != 'null'::jsonb THEN
        INSERT INTO load_offers (
            order_display_id, customer_id, customer_name,
            route_label, route_subtitle,
            pickup_address, pickup_lat, pickup_lng,
            drop_address, drop_lat, drop_lng,
            goods_type, weight,
            freight_value, fuel_cost, toll_cost, net_profit, extra_distance_km,
            status
        ) VALUES (
            p_order_data->>'order_display_id',
            v_customer_id,
            p_load_offer_data->>'customer_name',
            p_load_offer_data->>'route_label',
            p_load_offer_data->>'route_subtitle',
            p_load_offer_data->>'pickup_address',
            (p_load_offer_data->>'pickup_lat')::DOUBLE PRECISION,
            (p_load_offer_data->>'pickup_lng')::DOUBLE PRECISION,
            p_load_offer_data->>'drop_address',
            (p_load_offer_data->>'drop_lat')::DOUBLE PRECISION,
            (p_load_offer_data->>'drop_lng')::DOUBLE PRECISION,
            p_load_offer_data->>'goods_type',
            p_load_offer_data->>'weight',
            (p_load_offer_data->>'freight_value')::INTEGER,
            (p_load_offer_data->>'fuel_cost')::INTEGER,
            (p_load_offer_data->>'toll_cost')::INTEGER,
            (p_load_offer_data->>'net_profit')::INTEGER,
            (p_load_offer_data->>'extra_distance_km')::INTEGER,
            COALESCE(p_load_offer_data->>'status', 'available')
        );
    END IF;

    -- 6. Store completed result
    v_result := jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'display_id', p_order_data->>'order_display_id',
        'status', v_status
    );

    UPDATE order_idempotency_records
    SET status = 'completed',
        order_id = v_order_id,
        response_body = v_result,
        updated_at = NOW()
    WHERE idempotency_key = p_idempotency_key;

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    -- On failure, mark idempotency record as failed
    UPDATE order_idempotency_records
    SET status = 'failed',
        updated_at = NOW()
    WHERE idempotency_key = p_idempotency_key;
    RAISE;
END;
$$;

-- Idempotency-key replay is a backend concern; only the service-role key may
-- invoke this function directly (mirrors register_device_token's hardening).
REVOKE EXECUTE ON FUNCTION create_order_tx(text, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_order_tx(text, jsonb, jsonb, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION create_order_tx(text, jsonb, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_order_tx(text, jsonb, jsonb, jsonb) TO service_role;
