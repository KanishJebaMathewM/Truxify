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

CREATE POLICY "Drivers and Customers can view telemetry for their loads" ON temperature_telemetry
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM load_offers
      WHERE load_offers.id = temperature_telemetry.load_id
      AND (load_offers.customer_id = auth.uid() OR load_offers.driver_id = auth.uid())
    )
  );

CREATE POLICY "API can insert telemetry" ON temperature_telemetry
  FOR INSERT
  WITH CHECK (true); -- Usually restricted to a service role or specific authenticated user in production
