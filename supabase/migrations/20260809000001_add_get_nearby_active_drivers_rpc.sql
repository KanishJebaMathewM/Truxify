-- Migration: Add get_nearby_active_drivers RPC (fixes findTargetDrivers full
-- table scan in orderCreationService.js)
--
-- Problem:
--   findTargetDrivers() pulled every active, recently-updated driver location
--   nationwide from driver_locations, then filtered by haversine distance in
--   JS. The GIST index on driver_locations.location
--   (idx_driver_locations_location, added in
--   20260727120000_add_postgis_geospatial_indexes.sql) was built for exactly
--   this radius search but was never queried via ST_DWithin -- every order
--   creation paid for a full-table row fetch instead of an index scan.
--
-- Fix:
--   Push the is_active / freshness / radius filtering into Postgres via
--   ST_DWithin against the indexed geography column, so the GIST index is
--   actually used and only matching rows cross the wire.
--
-- SECURITY DEFINER + service_role-only grant, mirroring the existing
-- backend-only RPCs (e.g. complete_trip_tx): driver_locations has no anon
-- privileges (see revoke_anon_privileges.sql) and the backend API talks to
-- Supabase via the service_role key, so this RPC is only ever invoked
-- server-side.

CREATE OR REPLACE FUNCTION get_nearby_active_drivers(
  origin_lat        DOUBLE PRECISION,
  origin_lng        DOUBLE PRECISION,
  radius_meters      DOUBLE PRECISION,
  freshness_seconds INTEGER
)
RETURNS TABLE (driver_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT dl.driver_id
  FROM driver_locations dl
  WHERE dl.is_active = true
    AND dl.last_updated_at >= (now() - make_interval(secs => freshness_seconds))
    AND dl.location IS NOT NULL
    AND ST_DWithin(
          dl.location,
          ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography,
          radius_meters
        );
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation;
-- granting to service_role afterward does not revoke that. Revoke first.
REVOKE EXECUTE ON FUNCTION get_nearby_active_drivers(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_nearby_active_drivers(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO service_role;
