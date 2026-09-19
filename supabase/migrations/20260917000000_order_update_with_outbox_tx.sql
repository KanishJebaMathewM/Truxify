-- =============================================================================
-- Migration: Atomic order mutation with transactional outbox event
-- Issue #11215: Outbox writeEvent Is Not Atomic With the Order Mutation
-- =============================================================================
-- Problem:
--   Previously, updateOrder in orderRepository updated orders via PostgREST
--   and then fired a separate HTTP POST to write an outbox event.
--   If the application crashed, network failed, or the process was killed in the
--   gap between the two operations, the order mutation remained committed but
--   the outbox event was never written. Downstream consumers (read model, Kafka,
--   notifications, fraud checks) permanently diverged from orders.
--
-- Fix:
--   1. Add unique deduplication constraint & idempotency_key to outbox_events.
--   2. Introduce order_update_with_outbox RPC to mutate orders AND insert
--      into outbox_events atomically inside a single database transaction.
-- =============================================================================

BEGIN;

-- 1. Ensure idempotency_key column and unique deduplication index exist on outbox_events
CREATE TABLE IF NOT EXISTS public.outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL DEFAULT 'order',
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempted_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.outbox_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_events_idempotency_key
  ON public.outbox_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_events_dedupe_agg_type_created
  ON public.outbox_events (aggregate_id, event_type, created_at);

-- 2. Create the atomic transaction RPC
CREATE OR REPLACE FUNCTION public.order_update_with_outbox(
  p_order_id          UUID,
  p_updates           JSONB,
  p_event_type        TEXT DEFAULT NULL,
  p_payload           JSONB DEFAULT NULL,
  p_idempotency_key   TEXT DEFAULT NULL
)
RETURNS SETOF public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_aggregate_id TEXT;
  v_event_payload JSONB;
BEGIN
  -- Authorize caller
  IF auth.role() IS NOT NULL AND auth.role() NOT IN ('service_role', 'authenticated') THEN
    RAISE EXCEPTION 'Unauthorized to execute order_update_with_outbox';
  END IF;

  -- 1. Lock existing order row
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN;
  END IF;

  -- 2. Update order row fields from p_updates
  UPDATE public.orders
     SET status                         = CASE WHEN p_updates ? 'status' THEN (p_updates->>'status') ELSE orders.status END,
         driver_id                      = CASE WHEN p_updates ? 'driver_id' THEN (p_updates->>'driver_id')::uuid ELSE orders.driver_id END,
         escrow_status                  = CASE WHEN p_updates ? 'escrow_status' THEN (p_updates->>'escrow_status') ELSE orders.escrow_status END,
         escrow_funding_error           = CASE WHEN p_updates ? 'escrow_funding_error' THEN (p_updates->>'escrow_funding_error') ELSE orders.escrow_funding_error END,
         escrow_funding_attempts        = CASE WHEN p_updates ? 'escrow_funding_attempts' THEN (p_updates->>'escrow_funding_attempts')::integer ELSE orders.escrow_funding_attempts END,
         escrow_funding_last_attempt_at = CASE WHEN p_updates ? 'escrow_funding_last_attempt_at' THEN (p_updates->>'escrow_funding_last_attempt_at')::timestamptz ELSE orders.escrow_funding_last_attempt_at END,
         escrow_refund_error            = CASE WHEN p_updates ? 'escrow_refund_error' THEN (p_updates->>'escrow_refund_error') ELSE orders.escrow_refund_error END,
         escrow_refund_attempts         = CASE WHEN p_updates ? 'escrow_refund_attempts' THEN (p_updates->>'escrow_refund_attempts')::integer ELSE orders.escrow_refund_attempts END,
         escrow_refund_last_attempt_at  = CASE WHEN p_updates ? 'escrow_refund_last_attempt_at' THEN (p_updates->>'escrow_refund_last_attempt_at')::timestamptz ELSE orders.escrow_refund_last_attempt_at END,
         escrow_release_error           = CASE WHEN p_updates ? 'escrow_release_error' THEN (p_updates->>'escrow_release_error') ELSE orders.escrow_release_error END,
         escrow_release_attempts        = CASE WHEN p_updates ? 'escrow_release_attempts' THEN (p_updates->>'escrow_release_attempts')::integer ELSE orders.escrow_release_attempts END,
         escrow_release_last_attempt_at = CASE WHEN p_updates ? 'escrow_release_last_attempt_at' THEN (p_updates->>'escrow_release_last_attempt_at')::timestamptz ELSE orders.escrow_release_last_attempt_at END,
         deposit_tx_hash                = CASE WHEN p_updates ? 'deposit_tx_hash' THEN (p_updates->>'deposit_tx_hash') ELSE orders.deposit_tx_hash END,
         refund_tx_hash                 = CASE WHEN p_updates ? 'refund_tx_hash' THEN (p_updates->>'refund_tx_hash') ELSE orders.refund_tx_hash END,
         release_tx_hash                = CASE WHEN p_updates ? 'release_tx_hash' THEN (p_updates->>'release_tx_hash') ELSE orders.release_tx_hash END,
         blockchain_tx_hash             = CASE WHEN p_updates ? 'blockchain_tx_hash' THEN (p_updates->>'blockchain_tx_hash') ELSE orders.blockchain_tx_hash END,
         cancellation_reason            = CASE WHEN p_updates ? 'cancellation_reason' THEN (p_updates->>'cancellation_reason') ELSE orders.cancellation_reason END,
         cancellation_fee               = CASE WHEN p_updates ? 'cancellation_fee' THEN (p_updates->>'cancellation_fee')::numeric ELSE orders.cancellation_fee END,
         pending_bid_acceptance         = CASE WHEN p_updates ? 'pending_bid_acceptance' THEN (p_updates->'pending_bid_acceptance') ELSE orders.pending_bid_acceptance END,
         reconciled_at                  = CASE WHEN p_updates ? 'reconciled_at' THEN (p_updates->>'reconciled_at')::timestamptz ELSE orders.reconciled_at END,
         updated_at                     = NOW()
   WHERE id = p_order_id
   RETURNING * INTO v_order;

  -- 3. Atomically write to outbox inside the same transaction
  IF p_event_type IS NOT NULL AND TRIM(p_event_type) <> '' THEN
    v_aggregate_id := COALESCE(v_order.order_display_id, p_order_id::text);
    v_event_payload := COALESCE(p_payload, jsonb_build_object(
      'orderId', p_order_id::text,
      'orderDisplayId', v_order.order_display_id,
      'status', v_order.status,
      'updates', p_updates
    ));

    IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
      INSERT INTO public.outbox_events (
        aggregate_id,
        aggregate_type,
        event_type,
        payload,
        status,
        idempotency_key
      )
      VALUES (
        v_aggregate_id,
        'order',
        p_event_type,
        v_event_payload,
        'pending',
        p_idempotency_key
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    ELSE
      INSERT INTO public.outbox_events (
        aggregate_id,
        aggregate_type,
        event_type,
        payload,
        status
      )
      VALUES (
        v_aggregate_id,
        'order',
        p_event_type,
        v_event_payload,
        'pending'
      );
    END IF;
  END IF;

  RETURN NEXT v_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.order_update_with_outbox(UUID, JSONB, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_update_with_outbox(UUID, JSONB, TEXT, JSONB, TEXT) TO service_role, authenticated;

COMMIT;
