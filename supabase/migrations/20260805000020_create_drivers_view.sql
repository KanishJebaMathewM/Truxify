-- Migration: create drivers view for the GraphQL Driver subgraph
-- Backs backend/graphql/services/driver.service.js which queries `.from('drivers')`
-- (5 sites: driver, drivers, nearbyDrivers, updateDriver, updateDriverLocation).
-- No table/view named `drivers` existed, so every resolver failed with
-- relation "drivers" does not exist. The view maps the resolvers' columns onto
-- profiles + driver_details + trucks + driver_locations.

CREATE OR REPLACE VIEW drivers AS
SELECT
  dd.id                 AS id,
  dd.user_id            AS user_id,
  p.full_name           AS name,
  p.phone               AS phone,
  t.truck_type          AS truck_type,
  t.number_plate        AS truck_number,
  CASE WHEN dd.is_online THEN 'AVAILABLE' ELSE 'OFFLINE' END AS status,
  jsonb_build_object(
    'lat', dl.latitude,
    'lng', dl.longitude,
    'address', COALESCE(dl.accuracy::text, '')
  )                     AS current_location,
  dd.rating             AS rating,
  dd.total_trips        AS trips_completed,
  dd.updated_at         AS updated_at
FROM driver_details dd
JOIN profiles p       ON p.id = dd.user_id
LEFT JOIN trucks t    ON t.id = dd.truck_id
LEFT JOIN driver_locations dl ON dl.driver_id = dd.user_id AND dl.is_active = true;

-- RLS on views is not enforced by PostgREST for the GraphQL client; keep it simple
-- and readable. The subgraph service uses the service/client key.

-- ---------------------------------------------------------------------------
-- Updatable view support for updateDriver / updateDriverLocation mutations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_drivers_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE driver_details
       SET is_online = (NEW.status = 'AVAILABLE')
     WHERE id = NEW.id;
  END IF;

  IF NEW.truck_type IS DISTINCT FROM OLD.truck_type
     OR NEW.truck_number IS DISTINCT FROM OLD.truck_number THEN
    UPDATE trucks t
       SET truck_type   = COALESCE(NEW.truck_type, t.truck_type),
           number_plate = COALESCE(NEW.truck_number, t.number_plate)
     WHERE t.driver_id = NEW.user_id;
  END IF;

  IF NEW.current_location IS DISTINCT FROM OLD.current_location THEN
    INSERT INTO driver_locations (driver_id, latitude, longitude, accuracy, is_active)
    VALUES (
      NEW.user_id,
      (NEW.current_location ->> 'lat')::numeric(10, 8),
      (NEW.current_location ->> 'lng')::numeric(11, 8),
      NULL,
      true
    )
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE driver_details SET updated_at = now() WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER drivers_update_trigger
  INSTEAD OF UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION sync_drivers_update();
