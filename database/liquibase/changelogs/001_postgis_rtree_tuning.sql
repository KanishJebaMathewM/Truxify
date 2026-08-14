-- Liquibase Changelog: 001_postgis_rtree_tuning.sql
-- Spatial R-Tree GiST indexing and ST_DWithin query optimization for PostGIS

-- 1. Enable PostGIS Extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Add spatial GiST (R-Tree) index on driver locations
CREATE INDEX IF NOT EXISTS idx_driver_locations_gist 
ON driver_details USING GIST (current_location);

-- 3. Optimized Spatial Proximity Query Function
CREATE OR REPLACE FUNCTION find_nearby_drivers_fast(
    origin_lat DOUBLE PRECISION,
    origin_lng DOUBLE PRECISION,
    radius_meters DOUBLE PRECISION
)
RETURNS TABLE (
    driver_id UUID,
    distance_meters DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.driver_id,
        ST_Distance(d.current_location, ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography) AS distance_meters
    FROM driver_details d
    WHERE d.current_location && ST_Buffer(ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography, radius_meters)::geometry
      AND ST_DWithin(d.current_location, ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography, radius_meters)
    ORDER BY distance_meters ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
