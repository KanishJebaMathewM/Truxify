-- Migration to add Cold Chain Tracking to load offers
ALTER TABLE load_offers ADD COLUMN requires_refrigeration BOOLEAN DEFAULT false;
ALTER TABLE load_offers ADD COLUMN target_temperature_min NUMERIC;
ALTER TABLE load_offers ADD COLUMN target_temperature_max NUMERIC;

CREATE TABLE IF NOT EXISTS temperature_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id UUID REFERENCES load_offers(id) ON DELETE CASCADE,
  temperature NUMERIC NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS for temperature_telemetry
ALTER TABLE temperature_telemetry ENABLE ROW LEVEL SECURITY;

-- Drivers and Customers can view telemetry for their loads. get_profile_id()
-- maps the Firebase JWT sub to profiles.id, which is what load_offers
-- customer_id/driver_id actually store (auth.uid() is the Firebase UID and
-- would never match for Firebase-auth users).
CREATE POLICY "Drivers and Customers can view telemetry for their loads" ON temperature_telemetry
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM load_offers
      WHERE load_offers.id = temperature_telemetry.load_id
      AND (load_offers.customer_id = get_profile_id() OR load_offers.driver_id = get_profile_id())
    )
  );

-- Only the service-role backend (which bypasses RLS) may insert telemetry.
-- Direct anon/authenticated clients cannot forge readings for arbitrary loads.
CREATE POLICY "API can insert telemetry" ON temperature_telemetry
  FOR INSERT TO service_role
  WITH CHECK (true);
