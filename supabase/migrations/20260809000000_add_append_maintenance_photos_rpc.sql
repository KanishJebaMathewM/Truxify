-- Migration: Add append_maintenance_photos RPC (fixes #8835)
-- POST /api/maintenance/:ticketId/photos calls supabase.rpc('append_maintenance_photos')
-- with (p_ticket_id, p_new_paths, p_max_photos), but the function was never
-- defined in any migration, so every upload failed with:
--   '42883 function append_maintenance_photos(...) does not exist'
-- This defines it: it locks the ticket row, re-verifies the caller owns the
-- ticket, enforces the max-photo cap atomically (so concurrent uploads cannot
-- exceed the limit), and appends the new storage paths to photo_urls.

CREATE OR REPLACE FUNCTION public.append_maintenance_photos(
  p_ticket_id   UUID,
  p_new_paths   TEXT[],
  p_max_photos  INTEGER
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing  TEXT[];
  v_driver_id UUID;
BEGIN
  -- The controller checks ownership before uploading, but re-verify inside the
  -- RPC so the row lock + write can only be performed on a ticket the caller
  -- actually owns (auth.uid() is NULL for unauthenticated calls).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT photo_urls, driver_id
    INTO v_existing, v_driver_id
    FROM truck_maintenance_tickets
    WHERE id = p_ticket_id
    FOR UPDATE;

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Maintenance ticket not found';
  END IF;

  IF v_driver_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: you can only add photos to your own tickets';
  END IF;

  IF coalesce(array_length(v_existing, 1), 0) + coalesce(array_length(p_new_paths, 1), 0) > p_max_photos THEN
    RAISE EXCEPTION 'MAX_PHOTOS_EXCEEDED';
  END IF;

  UPDATE truck_maintenance_tickets
    SET photo_urls = coalesce(v_existing, '{}') || p_new_paths
    WHERE id = p_ticket_id;
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation;
-- granting to authenticated afterward does not revoke that. Revoke first.
REVOKE EXECUTE ON FUNCTION public.append_maintenance_photos(UUID, TEXT[], INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_maintenance_photos(UUID, TEXT[], INTEGER) TO authenticated;
