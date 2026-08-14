BEGIN;

-- Migration: Add the append_maintenance_photos RPC
--
-- Issue #9373: POST /api/maintenance/:ticketId/photos calls
-- public.append_maintenance_photos(...) but no SQL in the repository ever
-- created the function (PostgREST returns PGRST202 "Could not find the
-- function"). The upload therefore always failed at the final database step
-- with 500 "Failed to save photo references". This migration ships the
-- missing function so the atomic photo append actually works.

-- RPC: append_maintenance_photos — Atomically append photo storage paths to a
-- maintenance ticket while enforcing the MAX_PHOTOS cap under a row lock.
-- SECURITY DEFINER so the row lock + ownership check work for both the owning
-- driver (authenticated) and the backend (service_role). The controller's
-- ticket lookup is advisory; this row lock is authoritative against
-- concurrent uploads on the same ticket.
CREATE OR REPLACE FUNCTION public.append_maintenance_photos(
  p_ticket_id UUID,
  p_new_paths TEXT[],
  p_max_photos INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket truck_maintenance_tickets%ROWTYPE;
  v_existing_count INTEGER;
  v_total_count INTEGER;
BEGIN
  -- Lock the ticket row to serialize concurrent photo appends.
  SELECT * INTO v_ticket
  FROM truck_maintenance_tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'MAINTENANCE_TICKET_NOT_FOUND';
  END IF;

  -- Identity is derived from the JWT; service_role is the backend itself.
  -- IS DISTINCT FROM fails closed when the caller has no resolvable profile
  -- (get_profile_id() IS NULL).
  IF auth.role() <> 'service_role'
     AND get_profile_id() IS DISTINCT FROM v_ticket.driver_id THEN
    RAISE EXCEPTION 'Access Denied: You do not own this maintenance ticket.';
  END IF;

  v_existing_count := COALESCE(array_length(v_ticket.photo_urls, 1), 0);
  v_total_count := v_existing_count + COALESCE(array_length(p_new_paths, 1), 0);

  IF v_total_count > p_max_photos THEN
    RAISE EXCEPTION 'MAX_PHOTOS_EXCEEDED';
  END IF;

  UPDATE truck_maintenance_tickets
  SET photo_urls = COALESCE(v_ticket.photo_urls, '{}') || COALESCE(p_new_paths, '{}')
  WHERE id = p_ticket_id;
END;
$$;

-- The owning driver can append photos via an authenticated client; the
-- backend uses the service-role client.
GRANT EXECUTE ON FUNCTION public.append_maintenance_photos(UUID, TEXT[], INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_maintenance_photos(UUID, TEXT[], INTEGER) TO service_role;

COMMIT;
