-- Migration: Isolate delivery OTP into a dedicated table with RLS
-- Removes OTP columns from orders to prevent leak via broad RLS policies.

-- 1. Create the isolated delivery_otps table
CREATE TABLE IF NOT EXISTS delivery_otps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  otp_hash      TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  verified      BOOLEAN NOT NULL DEFAULT false,
  verified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_otps_order_id ON delivery_otps(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_otps_expires_at ON delivery_otps(expires_at);

-- 2. Enable RLS
ALTER TABLE delivery_otps ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies

-- Customers can read their own delivery OTPs (needed for verification flow)
CREATE POLICY customer_select_delivery_otp ON delivery_otps
  FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM orders WHERE customer_id = auth.uid()
    )
  );

-- Drivers cannot select delivery OTPs at all
CREATE POLICY no_driver_select_delivery_otp ON delivery_otps
  FOR SELECT
  USING (false);

-- Only the service role (backend) can insert / update delivery OTPs
CREATE POLICY service_insert_delivery_otp ON delivery_otps
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY service_update_delivery_otp ON delivery_otps
  FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4. Drop old OTP columns from orders table
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_otp;
ALTER TABLE orders DROP COLUMN IF EXISTS otp_verified;
ALTER TABLE orders DROP COLUMN IF EXISTS otp_generated_at;

-- 5. Update complete_trip_tx RPC (no OTP changes needed — it uses orders.total_amount only)
