-- Migration: add driver busy state to driver_details and expose it via the
-- drivers view so the GraphQL DriverStatus.BUSY enum is representable end-to-end.
-- Backs backend/graphql/services/driver.service.js which reads/writes the
-- `drivers` view created by 20260805000020_create_drivers_view.sql.

-- 1. Persist busy state on driver_details (existing rows default to available).
ALTER TABLE driver_details
  ADD COLUMN IF NOT EXISTS is_busy boolean NOT NULL DEFAULT false;

-- 2. Redefine the drivers view: status now emits BUSY, and availability /
--    is_busy are exposed as writable columns so updateDriver can set them.
CREATE OR REPLACE VIEW drivers AS
SELECT
  dd.id                 AS id,
  dd.user_id            AS user_id,
  p.full_name           AS name,
  p.phone               AS phone,
  t.truck_type          AS truck_type,
  t.number_plate        AS truck_number,
  CASE
    WHEN dd.is_online AND dd.is_busy THEN 'BUSY'
    WHEN dd.is_online THEN 'AVAILABLE'
    ELSE 'OFFLINE'
  END                   AS status,
  dd.is_online          AS availability,
  dd.is_busy            AS is_busy,
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
LEFT JOIN LATERAL (
  SELECT *
  FROM driver_locations
  WHERE driver_id = dd.user_id AND is_active = true
  ORDER BY id DESC
  LIMIT 1
) dl ON true;

-- 3. Teach the INSTEAD OF UPDATE trigger how to persist status, availability
--    and is_busy back to driver_details.
CREATE OR REPLACE FUNCTION sync_drivers_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE driver_details
       SET is_online = (NEW.status IN ('AVAILABLE', 'BUSY')),
           is_busy   = (NEW.status = 'BUSY')
     WHERE id = NEW.id;
  END IF;

  IF NEW.availability IS DISTINCT FROM OLD.availability THEN
    UPDATE driver_details
       SET is_online = NEW.availability
     WHERE id = NEW.id;
  END IF;

  IF NEW.is_busy IS DISTINCT FROM OLD.is_busy THEN
    UPDATE driver_details
       SET is_busy = NEW.is_busy
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
    UPDATE driver_locations
       SET is_active = false
     WHERE driver_id = NEW.user_id AND is_active = true;

    INSERT INTO driver_locations (driver_id, latitude, longitude, accuracy, is_active)
    VALUES (
      NEW.user_id,
      (NEW.current_location ->> 'lat')::numeric(10, 8),
      (NEW.current_location ->> 'lng')::numeric(11, 8),
      NULL,
      true
    );
  END IF;

  UPDATE driver_details SET updated_at = now() WHERE id = NEW.id;

  RETURN NEW;
END;
$$;
