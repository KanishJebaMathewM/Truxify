-- #17040: Postgres owns ETA generations; Redis is not a write fence.
BEGIN;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS eta_calculation_generation uuid,
  ADD COLUMN IF NOT EXISTS eta_arrival_epoch_ms bigint;

-- A reassigned driver starts a new ETA leg, even when the arrival barely changes.
CREATE OR REPLACE FUNCTION public.reset_order_eta_on_driver_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    NEW.eta_calculation_generation := NULL;
    NEW.eta_arrival_epoch_ms := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS orders_reset_eta_on_driver_change ON public.orders;
CREATE TRIGGER orders_reset_eta_on_driver_change
  BEFORE UPDATE OF driver_id ON public.orders FOR EACH ROW
  EXECUTE FUNCTION public.reset_order_eta_on_driver_change();
REVOKE ALL ON FUNCTION public.reset_order_eta_on_driver_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_order_eta_on_driver_change() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_order_eta_generation(
  p_order_id uuid, p_driver_id uuid, p_expected_status text
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_generation uuid;
BEGIN
  UPDATE public.orders AS o
  SET eta_calculation_generation = pg_catalog.gen_random_uuid()
  WHERE o.id = p_order_id AND o.driver_id = p_driver_id
    AND o.status::text = p_expected_status
    AND o.status::text = ANY(ARRAY['active','truck_assigned','en_route_pickup','arrived_pickup','picked_up','in_transit','arriving'])
  RETURNING o.eta_calculation_generation INTO v_generation;
  RETURN v_generation;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_order_eta_generation(
  p_order_id uuid, p_driver_id uuid, p_expected_status text, p_generation uuid,
  p_eta text, p_arrival_epoch_ms bigint, p_change_threshold_seconds double precision
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_generation IS NULL OR p_eta IS NULL OR pg_catalog.btrim(p_eta) = ''
     OR p_arrival_epoch_ms IS NULL OR p_arrival_epoch_ms NOT BETWEEN 0 AND 8640000000000000
     OR p_change_threshold_seconds IS NULL OR p_change_threshold_seconds < 0
     OR p_change_threshold_seconds::text IN ('NaN','Infinity','-Infinity') THEN
    RETURN NULL;
  END IF;
  -- UPDATE serializes on the row and rechecks generation/status after a wait.
  UPDATE public.orders AS o
  SET eta = p_eta, eta_arrival_epoch_ms = p_arrival_epoch_ms,
      updated_at = pg_catalog.clock_timestamp()
  WHERE o.id = p_order_id AND o.driver_id = p_driver_id
    AND o.eta_calculation_generation = p_generation
    AND o.status::text = p_expected_status
    AND o.status::text = ANY(ARRAY['active','truck_assigned','en_route_pickup','arrived_pickup','picked_up','in_transit','arriving'])
    AND (o.eta_arrival_epoch_ms IS NULL OR
         pg_catalog.abs(o.eta_arrival_epoch_ms::numeric - p_arrival_epoch_ms::numeric)
           >= p_change_threshold_seconds::numeric * 1000)
  RETURNING pg_catalog.jsonb_build_object(
    'id',o.id,'order_display_id',o.order_display_id,'eta',o.eta,'status',o.status,
    'generation',o.eta_calculation_generation,'arrivalEpochMs',o.eta_arrival_epoch_ms
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_order_eta_generation(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_order_eta_generation(uuid,uuid,text,uuid,text,bigint,double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_eta_generation(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_order_eta_generation(uuid,uuid,text,uuid,text,bigint,double precision) TO service_role;
COMMENT ON COLUMN public.orders.eta_calculation_generation IS 'Opaque current ETA generation, claimed and conditionally committed under row serialization.';
COMMENT ON COLUMN public.orders.eta_arrival_epoch_ms IS 'Committed arrival epoch for atomic ETA-change admission; Redis is advisory.';
COMMIT;
