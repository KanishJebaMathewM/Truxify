-- Migration: Add durable idempotency table and extend create_order_tx RPC

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
    p_order_data JSONB,
    p_timeline_data JSONB,
    p_load_offer_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_record RECORD;
    v_order_id UUID;
    v_result JSONB;
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

    -- 3. Perform atomic Order Creation
    INSERT INTO orders (
        display_id, customer_id, pickup_location, dropoff_location, accepted_bid_amount, status
    ) VALUES (
        p_order_data->>'display_id',
        (p_order_data->>'customer_id')::UUID,
        p_order_data->'pickup_location',
        p_order_data->'dropoff_location',
        (p_order_data->>'accepted_bid_amount')::NUMERIC,
        COALESCE(p_order_data->>'status', 'created')
    )
    RETURNING id INTO v_order_id;

    -- 4. Insert Order Timeline record
    INSERT INTO order_timelines (order_id, status, details, created_at)
    VALUES (
        v_order_id,
        COALESCE(p_timeline_data->>'status', 'created'),
        p_timeline_data->'details',
        NOW()
    );

    -- 5. Insert Load Offer record if present
    IF p_load_offer_data IS NOT NULL AND p_load_offer_data != 'null'::jsonb THEN
        INSERT INTO load_offers (order_id, driver_id, offer_amount, status, created_at)
        VALUES (
            v_order_id,
            (p_load_offer_data->>'driver_id')::UUID,
            (p_load_offer_data->>'offer_amount')::NUMERIC,
            COALESCE(p_load_offer_data->>'status', 'pending'),
            NOW()
        );
    END IF;

    -- 6. Store completed result
    v_result := jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'display_id', p_order_data->>'display_id',
        'status', COALESCE(p_order_data->>'status', 'created')
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
