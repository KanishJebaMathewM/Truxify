-- =============================================================================
-- Migration: Enforce a unique constraint on orders.order_display_id (Issue #5740)
-- =============================================================================
-- Problem:
--   generateOrderDisplayId() previously returned `#FF` + YYYYMMDD + a 6-digit
--   random suffix — only ~900k values per calendar day. With the birthday
--   paradox, ~950 orders/day yields a >50% daily collision probability. There
--   is no explicit migration guaranteeing uniqueness of order_display_id, so
--   two orders can share the same display id, which:
--     - makes findOrderByDisplayId return the first match (tracking/timeline
--       show the wrong order), and
--     - derives the same on-chain escrow booking id via getEscrowBookingId,
--       so the second order's deposit reverts on-chain ("Booking already
--       exists") or the idempotency checks in recordDepositTx accept a booking
--       created for the wrong order, permanently breaking funding/payout.
--
-- Fix:
--   1. The backend generator now draws a 12-char alphanumeric suffix from a
--      36-char alphabet (36^12 ≈ 4.7e18 values/day) and re-rolls on a
--      unique-constraint violation (see src/lib/orderDisplayId.js).
--   2. This migration guarantees a UNIQUE constraint on
--      orders.order_display_id as a database-level safety net. It is a no-op
--      when the constraint already exists (the canonical schema in
--      docs/supabase_setup.sql declares `order_display_id text unique not
--      null`), and it refuses to run when duplicate display ids exist so an
--      operator can resolve the data instead of shipping with collisions.
--
-- Backward compatibility:
--   - Idempotent: skips when orders_order_display_id_key already exists.
--   - Fails loudly (rather than partially enforcing) if duplicate display ids
--     are present, so existing corrupt data is surfaced before deployment.
--   - The FK ratings.order_display_id -> orders.order_display_id (added in
--     20260802030000) already required a unique constraint on the referenced
--     column, so production schemas following the canonical DDL already pass.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_order_display_id_key'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    -- Guard against adding the constraint on data that already contains
    -- duplicate display ids: uniqueness cannot be enforced retroactively
    -- without resolving those rows first.
    IF EXISTS (
      SELECT order_display_id
      FROM public.orders
      WHERE order_display_id IS NOT NULL
      GROUP BY order_display_id
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION
        'Cannot add unique constraint orders_order_display_id_key: duplicate order_display_id values exist. Resolve duplicates before running this migration.';
    END IF;

    ALTER TABLE public.orders
      ADD CONSTRAINT orders_order_display_id_key UNIQUE (order_display_id);
  END IF;
END;
$$;
