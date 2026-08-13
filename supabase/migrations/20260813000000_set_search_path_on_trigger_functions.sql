-- Pin search_path on the trigger functions that still lack it.
--
-- 20260706075009_secure_rpc_search_path.sql and
-- 20260809000004_set_search_path_on_remaining_definer_functions.sql hardened
-- every SECURITY DEFINER RPC, but the trigger functions were never covered. They
-- are declared with a bare `LANGUAGE plpgsql` / `RETURNS TRIGGER AS $$` and no
-- pinned search_path, so a caller who can create an object earlier on the path
-- can shadow a referenced relation/function and have it executed in the
-- trigger's security context — the same class of vulnerability the RPCs were
-- hardened against. This affects write paths on orders, trips and
-- driver_locations.
--
-- Affected functions:
--
--   * enforce_trip_status_transitions() — added in 20240101000000_rls.sql,
--     driven by trg_trips_status_transitions on trips.
--   * ensure_trip_on_assignment() — added in
--     20260805100000_create_trip_on_order_assignment.sql, driven by
--     trg_trips_ensure_on_assignment on orders.
--   * trg_update_driver_location() — added in
--     20260727120000_add_postgis_geospatial_indexes.sql, driven by
--     trigger_update_driver_location on driver_locations.
--
-- ALTER FUNCTION is used rather than CREATE OR REPLACE so the bodies are not
-- duplicated here and cannot drift from their defining migrations. Note that
-- sync_drivers_update() was audited and already declares
-- `SET search_path = public, pg_temp` in both
-- 20260805000020_create_drivers_view.sql and
-- 20260811090000_add_driver_busy_status.sql, so it needs no change.

ALTER FUNCTION public.enforce_trip_status_transitions()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.ensure_trip_on_assignment()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.trg_update_driver_location()
  SET search_path = public, pg_temp;
