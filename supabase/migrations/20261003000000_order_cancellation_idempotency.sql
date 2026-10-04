-- ============================================================================
-- Migration: 20261003000000_order_cancellation_idempotency.sql
-- Description: Add idempotency tracking and status columns for order cancellation flow.
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancellation_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_status TEXT;

-- Prevent duplicate cancellations under the same idempotency key for the same order
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_cancellation_idempotency_key
  ON public.orders (id, cancellation_idempotency_key)
  WHERE cancellation_idempotency_key IS NOT NULL;

-- Optimize lookups on cancellation status for reconciliation and monitoring
CREATE INDEX IF NOT EXISTS idx_orders_cancellation_status
  ON public.orders (cancellation_status)
  WHERE cancellation_status IS NOT NULL;
