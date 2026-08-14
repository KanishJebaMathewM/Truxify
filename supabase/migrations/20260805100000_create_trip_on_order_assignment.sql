-- =============================================================================
-- Migration: create trips/trip_items/trip_stops when an order is assigned (#6325)
-- =============================================================================
-- Problem:
--   No code path ever created a `trips` row. The trips RLS is read-only for
--   authenticated users and there was no service_role insert path, so the
--   driver app never saw an active trip, its /api/trips endpoints had nothing
--   to return, and complete_trip_tx raised `No active trip found` after the
--   on-chain escrow release (leaving the driver unpaid).
--
-- Fix:
--   A trigger on orders creates the trips/trip_items/trip_stops rows the moment
--   an order transitions into `truck_assigned`. This is atomic with the
--   assignment (accept_bid_tx / legacy accept both flow through the status
--   change), honors the trips status-transition trigger (trips are created
--   `active`), and is idempotent — it only fires on the transition into
--   truck_assigned and never duplicates an existing/linked trip. If the driver
--   already has another active trip the partial unique index
--   (idx_trips_one_active_per_driver) would reject the insert, so the trigger
--   skips creation instead of failing the assignment.
-- =============================================================================

CREATE OR REPLACE FUNCTION ensure_trip_on_assignment()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_trip text;
  v_driver_active_trip text;
  v_customer_name text;
  v_trip_display_id text;
  v_fuel_deducted int;
  v_distance_km numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'truck_assigned'
     AND OLD.status IS DISTINCT FROM 'truck_assigned' THEN

    -- Idempotency: a linked trip already exists (e.g. from a re-assignment).
    SELECT trip_display_id INTO v_existing_trip
    FROM trips
    WHERE order_id = NEW.id
    LIMIT 1;

    IF v_existing_trip IS NOT NULL THEN
      RETURN NEW;
    END IF;

    -- A driver can only have one active trip at a time
    -- (idx_trips_one_active_per_driver). Skip rather than fail the assignment.
    SELECT trip_display_id INTO v_driver_active_trip
    FROM trips
    WHERE driver_id = NEW.driver_id
      AND status = 'active'
    LIMIT 1;

    IF v_driver_active_trip IS NOT NULL THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(p.full_name, 'Customer') INTO v_customer_name
    FROM profiles p
    WHERE p.id = NEW.customer_id;

    v_trip_display_id := 'TX-' || NEW.order_display_id;

    -- Estimated fuel deduction mirrors the backend rate card
    -- (backend/api/src/lib/pricing.js DEFAULTS.FUEL_COST_PCT = 45% of base
    -- freight). It is a driver-side estimate for display only; wallet payouts
    -- use orders.total_amount.
    v_fuel_deducted := ROUND(COALESCE(NEW.base_freight, 0)::numeric * 45 / 100)::int;

    -- Straight-line (haversine) pickup → drop estimate, the same formula the
    -- pricing engine uses as its fallback when no road distance is available.
    v_distance_km := 6371.0088 * acos(least(1, greatest(-1,
      sin(radians(NEW.pickup_lat)) * sin(radians(NEW.drop_lat)) +
      cos(radians(NEW.pickup_lat)) * cos(radians(NEW.drop_lat)) *
      cos(radians(NEW.pickup_lng) - radians(NEW.drop_lng))
    )));

    INSERT INTO trips (
      trip_display_id, driver_id, order_id, route_label, status, trip_date,
      base_freight, total_earnings,
      platform_fee, toll_deducted, fuel_deducted, net_earnings, distance
    ) VALUES (
      v_trip_display_id,
      NEW.driver_id,
      NEW.id,
      NEW.pickup_address || ' → ' || NEW.drop_address,
      'active',
      COALESCE(NEW.pickup_date, CURRENT_DATE),
      COALESCE(NEW.base_freight, 0),
      COALESCE(NEW.total_amount, 0),
      COALESCE(NEW.platform_fee, 0),
      COALESCE(NEW.toll_estimate, 0),
      v_fuel_deducted,
      COALESCE(NEW.total_amount, 0)
        - COALESCE(NEW.platform_fee, 0)
        - COALESCE(NEW.toll_estimate, 0)
        - v_fuel_deducted,
      ROUND(v_distance_km)::text || ' km'
    );

    INSERT INTO trip_items (
      trip_display_id, customer_name, goods, destination, earnings,
      is_delivered, sort_order
    ) VALUES (
      v_trip_display_id,
      v_customer_name,
      NEW.goods_type,
      NEW.drop_address,
      COALESCE(NEW.total_amount, 0),
      false,
      1
    );

    INSERT INTO trip_stops (
      trip_display_id, customer_name, route_label, goods, drop_location, tonnes,
      status_label, sort_order, is_current, is_completed
    ) VALUES (
      v_trip_display_id,
      v_customer_name,
      NEW.pickup_address || ' → ' || NEW.drop_address,
      NEW.goods_type,
      NEW.drop_address,
      NEW.weight_tonnes::text,
      'In Progress',
      1,
      true,
      false
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trips_ensure_on_assignment ON orders;
CREATE TRIGGER trg_trips_ensure_on_assignment
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'truck_assigned')
  EXECUTE FUNCTION ensure_trip_on_assignment();

-- =============================================================================
-- Backfill: persist money/distance on trips created before this migration, so
-- previously-completed trips stop reporting NULL net_earnings/fuel_deducted
-- (the analytics endpoint and driver app then show real values, not ₹0/0 km).
-- Guarded on net_earnings IS NULL so it is idempotent. Duration is intentionally
-- left alone: the schema stores no trip start time, so it cannot be derived.
-- =============================================================================
update trips t
set platform_fee  = COALESCE(o.platform_fee, 0),
    toll_deducted = COALESCE(o.toll_estimate, 0),
    fuel_deducted = ROUND(COALESCE(o.base_freight, 0)::numeric * 45 / 100)::int,
    net_earnings  = COALESCE(o.total_amount, 0)
                    - COALESCE(o.platform_fee, 0)
                    - COALESCE(o.toll_estimate, 0)
                    - ROUND(COALESCE(o.base_freight, 0)::numeric * 45 / 100)::int,
    distance      = ROUND(6371.0088 * acos(least(1, greatest(-1,
                      sin(radians(o.pickup_lat)) * sin(radians(o.drop_lat)) +
                      cos(radians(o.pickup_lat)) * cos(radians(o.drop_lat)) *
                      cos(radians(o.pickup_lng) - radians(o.drop_lng))
                    ))))::text || ' km',
    updated_at    = now()
from orders o
where t.order_id = o.id
  and t.net_earnings is null;
