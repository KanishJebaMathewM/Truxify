-- Cross-docking synchronization engine (#6181)
--
-- Allows a load to be handed off between two drivers at a cross-dock meeting
-- point without intermediate storage. A transfer progresses:
--   requested -> accepted -> verified | declined | cancelled | expired
--
-- The original carrier (from_driver) creates the request for a candidate
-- handoff driver (to_driver); the handoff is completed when the to_driver
-- submits the one-time handoff code shared out-of-band by the from_driver.

CREATE TABLE IF NOT EXISTS public.cross_dock_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_driver_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_driver_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Cross-dock meeting point where the load physically changes hands.
  cross_dock_lat  numeric NOT NULL,
  cross_dock_lng  numeric NOT NULL,
  cross_dock_note text,
  -- Lifecycle: requested | accepted | verified | declined | cancelled | expired
  status          text NOT NULL DEFAULT 'requested',
  -- One-time handoff code shared by from_driver with to_driver; stored hashed.
  otp_hash        text,
  otp_expires_at  timestamptz,
  otp_attempts    integer NOT NULL DEFAULT 0,
  verified_at     timestamptz,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cross_dock_status_chk CHECK (
    status IN ('requested','accepted','verified','declined','cancelled','expired')
  ),
  CONSTRAINT cross_dock_self_assign_chk CHECK (from_driver_id <> to_driver_id)
);

CREATE INDEX IF NOT EXISTS idx_cross_dock_transfers_order
  ON public.cross_dock_transfers(order_id);
CREATE INDEX IF NOT EXISTS idx_cross_dock_transfers_to_driver_status
  ON public.cross_dock_transfers(to_driver_id, status);
CREATE INDEX IF NOT EXISTS idx_cross_dock_transfers_from_driver_status
  ON public.cross_dock_transfers(from_driver_id, status);

-- A single active (non-terminal) transfer per order at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cross_dock_active_per_order
  ON public.cross_dock_transfers(order_id)
  WHERE status IN ('requested','accepted');

-- updated_at maintenance.
CREATE OR REPLACE FUNCTION public.set_cross_dock_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cross_dock_set_updated_at ON public.cross_dock_transfers;
CREATE TRIGGER trg_cross_dock_set_updated_at
  BEFORE UPDATE ON public.cross_dock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_cross_dock_updated_at();

-- Row-level security. Mirrors the Truxify policy pattern:
--   1. service_role (backend API): full unrestricted CRUD.
--   2. authenticated (Flutter clients): only the two participating drivers may
--      read/insert/update their own transfers, with admin override for reads.
-- get_profile_id() maps the Firebase JWT sub to profiles.id, so it is used here
-- instead of auth.uid() for the driver columns (which reference profiles.id).
ALTER TABLE public.cross_dock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cross_dock_service_role_full_access ON public.cross_dock_transfers;
CREATE POLICY cross_dock_service_role_full_access ON public.cross_dock_transfers
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cross_dock_select_policy ON public.cross_dock_transfers;
CREATE POLICY cross_dock_select_policy ON public.cross_dock_transfers
  FOR SELECT TO authenticated
  USING (
    get_profile_id() = from_driver_id
    OR get_profile_id() = to_driver_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = get_profile_id() AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS cross_dock_insert_policy ON public.cross_dock_transfers;
CREATE POLICY cross_dock_insert_policy ON public.cross_dock_transfers
  FOR INSERT TO authenticated
  WITH CHECK (get_profile_id() = from_driver_id);

DROP POLICY IF EXISTS cross_dock_update_policy ON public.cross_dock_transfers;
CREATE POLICY cross_dock_update_policy ON public.cross_dock_transfers
  FOR UPDATE TO authenticated
  USING (
    get_profile_id() = from_driver_id
    OR get_profile_id() = to_driver_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = get_profile_id() AND p.role = 'admin'
    )
  );
