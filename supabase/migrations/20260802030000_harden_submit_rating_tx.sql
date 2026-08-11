-- =============================================================================
-- Migration: Harden submit_rating_tx — order ownership, delivery status and
-- driver-assignment validation
-- =============================================================================
-- Problem:
--   submit_rating_tx only verified auth.uid() = p_customer_id and 1 <= stars
--   <= 5. It inserted the caller-supplied p_order_display_id and p_driver_id
--   directly and recomputed driver_details.rating = AVG(stars) over ALL ratings
--   for that driver. It never checked that the order exists, belongs to
--   p_customer_id, is in 'delivered'/'payment_released', or that p_driver_id
--   was actually assigned to that order. The 2026-07-09 migration added a
--   duplicate-ratings UNIQUE constraint and UPSERT but no relationship
--   validation.
--
--   The backend checks (orderLifecycleService.js) are bypassable via direct
--   REST. The ratings RLS policy is FOR ALL ... WITH CHECK
--   (customer_id = get_profile_id()), so a customer could also directly INSERT
--   ratings rows for any driver_id; those rows then count toward the next AVG
--   recomputation.
--
-- Solution:
--   1. submit_rating_tx now rejects unless an order exists that is owned by the
--      caller, is in 'delivered'/'payment_released', and has the supplied
--      p_driver_id as its assigned driver.
--   2. The "Customers manage own ratings" RLS policy now also constrains
--      driver_id via the same order relationship, so direct INSERT/UPDATE via
--      the REST API is blocked too.
--   3. Add the missing ratings.order_display_id -> orders.order_display_id
--      foreign key (already present in docs/supabase_setup.sql but never
--      applied to the live DB), after deleting orphan rating rows whose
--      order_display_id references no real order.
--
-- Backward compatibility:
--   - RPC signature is unchanged (same parameters, same RETURNS void)
--   - The UPSERT duplicate guard from the 2026-07-09 migration is preserved
--   - Average rating is still recalculated from the full ratings set
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Harden submit_rating_tx with order relationship validation
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_rating_tx(
  p_order_display_id TEXT,
  p_customer_id      UUID,
  p_driver_id        UUID,
  p_stars            SMALLINT,
  p_comment          TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_avg NUMERIC(3,2);
BEGIN
  -- Verify the caller IS the customer.
  -- auth.uid() is the Firebase UID; get_profile_id() maps it to profiles.id
  -- which is what p_customer_id stores, so compare via get_profile_id().
  IF auth.uid() IS NOT NULL AND get_profile_id() <> p_customer_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only submit ratings for yourself';
  END IF;

  -- Validate star rating is between 1 and 5
  IF p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'Star rating must be between 1 and 5, got %', p_stars;
  END IF;

  -- Validate the order exists, is owned by the caller, is delivered or paid,
  -- and that p_driver_id is the driver assigned to that order.
  IF NOT EXISTS (
    SELECT 1
    FROM orders
    WHERE order_display_id = p_order_display_id
      AND customer_id      = p_customer_id
      AND driver_id        = p_driver_id
      AND status           IN ('delivered', 'payment_released')
  ) THEN
    RAISE EXCEPTION 'Order not found or not eligible for rating: the order must be delivered or payment released, owned by you, and completed by this driver';
  END IF;

  -- Upsert: first call inserts, subsequent calls replace the rating values.
  INSERT INTO ratings (order_display_id, customer_id, driver_id, stars, comment)
  VALUES (p_order_display_id, p_customer_id, p_driver_id, p_stars, p_comment)
  ON CONFLICT (order_display_id, customer_id)
  DO UPDATE SET
    stars      = EXCLUDED.stars,
    comment    = EXCLUDED.comment,
    updated_at = NOW();

  -- Recalculate the driver's average rating across all their ratings.
  SELECT ROUND(AVG(stars)::NUMERIC, 2)
  INTO v_new_avg
  FROM ratings
  WHERE driver_id = p_driver_id;

  UPDATE driver_details
  SET rating     = v_new_avg,
      updated_at = now()
  WHERE user_id = p_driver_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tighten the ratings RLS policy to also constrain driver_id
--    Direct INSERT/UPDATE via the REST API is only allowed when the order
--    exists, is owned by the rating customer, was completed by the rated
--    driver, and is delivered or payment released.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Customers manage own ratings" ON public.ratings;
CREATE POLICY "Customers manage own ratings"
  ON public.ratings FOR ALL TO authenticated
  USING (customer_id = get_profile_id())
  WITH CHECK (
    customer_id = get_profile_id()
    AND EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.order_display_id = ratings.order_display_id
        AND o.customer_id      = ratings.customer_id
        AND o.driver_id        = ratings.driver_id
        AND o.status           IN ('delivered', 'payment_released')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add the missing FK ratings.order_display_id -> orders.order_display_id
--    First delete orphan rating rows whose order_display_id references no real
--    order (unambiguously illegitimate rows created via direct REST), then add
--    the FK (orders.order_display_id is UNIQUE, see orders table DDL).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.ratings r
WHERE NOT EXISTS (
  SELECT 1 FROM public.orders o
  WHERE o.order_display_id = r.order_display_id
);

ALTER TABLE public.ratings
  DROP CONSTRAINT IF EXISTS ratings_order_display_id_fkey;
ALTER TABLE public.ratings
  ADD CONSTRAINT ratings_order_display_id_fkey
  FOREIGN KEY (order_display_id) REFERENCES public.orders(order_display_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;
