-- =============================================================================
-- Migration: Recompute driver average rating AFTER DELETE on ratings (#14938)
-- =============================================================================
-- Problem:
--   submit_rating_tx recomputes driver_details.rating = ROUND(AVG(stars)) only
--   on INSERT/UPDATE. The "Customers manage own ratings" RLS policy is
--   FOR ALL (permits DELETE via its USING clause), but there is no AFTER
--   DELETE trigger. So once a customer deletes their own rating, the stored
--   driver_details.rating is never refreshed and no longer equals AVG(stars)
--   over the remaining rows — the driver's displayed rating is permanently
--   wrong and reachable via PostgREST.
--
-- Solution:
--   Add an AFTER DELETE trigger that recomputes the affected driver's average
--   from the surviving ratings, mirroring the INSERT/UPDATE path in
--   submit_rating_tx. When the last rating is deleted, AVG() over an empty set
--   is NULL, so the driver's rating is set back to NULL (matching the column's
--   pre-rating state).
--
-- Idempotent: DROP ... IF EXISTS before CREATE for safe re-application.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Trigger function: recompute driver_details.rating for the deleted row's
--    driver from the remaining ratings.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recompute_driver_rating_after_rating_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_avg NUMERIC(3,2);
BEGIN
  -- Only the deleted row's driver is affected.
  SELECT ROUND(AVG(stars)::NUMERIC, 2)
  INTO v_new_avg
  FROM ratings
  WHERE driver_id = OLD.driver_id;

  UPDATE driver_details
  SET rating     = v_new_avg,
      updated_at = now()
  WHERE user_id = OLD.driver_id;

  RETURN OLD;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. AFTER DELETE trigger on ratings.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_ratings_after_delete_recompute ON public.ratings;

CREATE TRIGGER trg_ratings_after_delete_recompute
  AFTER DELETE ON public.ratings
  FOR EACH ROW
  EXECUTE FUNCTION recompute_driver_rating_after_rating_delete();
