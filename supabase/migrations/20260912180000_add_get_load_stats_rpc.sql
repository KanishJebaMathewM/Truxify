-- Migration: add_get_load_stats_rpc
-- Purpose: Returns aggregated marketplace load statistics (active loads, avg/min/max freight price, avg distance, nearby loads)
-- Date: 2026-09-12

CREATE OR REPLACE FUNCTION get_load_stats(p_vehicle_type TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_loads INT := 0;
  v_avg_freight_price NUMERIC := 0;
  v_min_freight_price NUMERIC := 0;
  v_max_freight_price NUMERIC := 0;
  v_avg_distance NUMERIC := 0;
  v_nearby_loads INT := 0;
  v_result JSON;
BEGIN
  -- Aggregate active loads matching vehicle type
  SELECT
    COALESCE(COUNT(*), 0),
    COALESCE(ROUND(AVG(freight_value) / 100.0, 2), 0),
    COALESCE(ROUND(MIN(freight_value) / 100.0, 2), 0),
    COALESCE(ROUND(MAX(freight_value) / 100.0, 2), 0),
    COALESCE(ROUND(AVG(extra_distance_km), 2), 0)
  INTO
    v_active_loads,
    v_avg_freight_price,
    v_min_freight_price,
    v_max_freight_price,
    v_avg_distance
  FROM load_offers
  WHERE status = 'available'
    AND (
      p_vehicle_type IS NULL
      OR p_vehicle_type = ''
      OR vehicle_type ILIKE p_vehicle_type
    );

  -- Count nearby active loads (within 50 km)
  SELECT COALESCE(COUNT(*), 0)
  INTO v_nearby_loads
  FROM load_offers
  WHERE status = 'available'
    AND (
      p_vehicle_type IS NULL
      OR p_vehicle_type = ''
      OR vehicle_type ILIKE p_vehicle_type
    )
    AND (extra_distance_km IS NULL OR extra_distance_km <= 50);

  v_result := json_build_object(
    'vehicleType', COALESCE(NULLIF(p_vehicle_type, ''), 'all'),
    'activeLoads', v_active_loads,
    'avgFreightPrice', v_avg_freight_price,
    'minFreightPrice', v_min_freight_price,
    'maxFreightPrice', v_max_freight_price,
    'avgDistance', v_avg_distance,
    'nearbyLoads', v_nearby_loads,
    'lastUpdated', to_json(NOW())
  );

  RETURN v_result;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION get_load_stats(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_load_stats(TEXT) TO service_role;
