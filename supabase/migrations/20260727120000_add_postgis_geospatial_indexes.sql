-- Enable PostGIS extension for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Add geography column to driver_locations
ALTER TABLE driver_locations 
ADD COLUMN IF NOT EXISTS location GEOGRAPHY(Point, 4326);

-- 2. Backfill existing data
UPDATE driver_locations 
SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND location IS NULL;

-- 3. Create the GIST index on the new geography column
CREATE INDEX IF NOT EXISTS idx_driver_locations_location ON driver_locations USING GIST(location);

-- 4. Create trigger to automatically maintain the location column
CREATE OR REPLACE FUNCTION trg_update_driver_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_driver_location ON driver_locations;
CREATE TRIGGER trigger_update_driver_location
BEFORE INSERT OR UPDATE OF latitude, longitude ON driver_locations
FOR EACH ROW EXECUTE FUNCTION trg_update_driver_location();
