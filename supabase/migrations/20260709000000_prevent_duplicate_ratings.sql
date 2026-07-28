-- =============================================================================
-- Migration: Prevent duplicate customer ratings
-- =============================================================================
-- Problem:
--   The submit_rating_tx RPC performed a plain INSERT with no unique constraint
--   on (order_display_id, customer_id). While the backend layer calls
--   assertNoDuplicateRating() before the RPC, there is no database-level
--   guard. Race conditions or direct Supabase client calls can create
--   duplicate rows, inflating reputation scores and distorting averages.
--
-- Solution:
--   1. Add updated_at column to ratings (required for UPSERT semantics)
--   2. Deduplicate any existing duplicate rows (keep oldest per order+customer)
--   3. Add a UNIQUE constraint on (order_display_id, customer_id)
--   4. Replace the plain INSERT in submit_rating_tx with INSERT ON CONFLICT
--      DO UPDATE so a second submission silently replaces the first
--   5. Attach the existing set_updated_at() trigger to the ratings table
--
-- Backward compatibility:
--   - RPC signature is unchanged (same parameters, same RETURNS void)
--   - Backend assertNoDuplicateRating() still fires first and returns 409
--   - The DB-level UPSERT is a safety net: if the backend check is bypassed,
--     the latest rating replaces the previous one instead of creating a dupe
--   - Average rating is always recalculated from the full ratings set
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add updated_at column
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ratings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Deduplicate existing data
--    Keep the oldest rating (by created_at, then id) per order+customer pair.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.ratings
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY order_display_id, customer_id
             ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM public.ratings
  ) ranked
  WHERE ranked.rn > 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add UNIQUE constraint on (order_display_id, customer_id)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ratings
  ADD CONSTRAINT ratings_order_display_id_customer_id_key
  UNIQUE (order_display_id, customer_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Replace submit_rating_tx with UPSERT version
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
  -- Verify the caller IS the customer
  IF auth.uid() <> p_customer_id THEN
    RAISE EXCEPTION 'Unauthorized: you can only submit ratings for yourself';
  END IF;

  -- Validate star rating is between 1 and 5
  IF p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'Star rating must be between 1 and 5, got %', p_stars;
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
-- 5. Attach updated_at trigger to ratings table
--    Uses the set_updated_at() function created in 20260707000000.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_ratings_updated_at ON public.ratings;
CREATE TRIGGER trg_ratings_updated_at
  BEFORE UPDATE ON public.ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
