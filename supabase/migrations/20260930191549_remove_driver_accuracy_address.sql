-- GPS accuracy is a measurement, not a postal address (issue #10498).
-- Preserve the latest view column order, BUSY state and existing update trigger.
-- GraphQL Location.address is nullable; lat/lng remain the stored location.
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
    'lng', dl.longitude
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

