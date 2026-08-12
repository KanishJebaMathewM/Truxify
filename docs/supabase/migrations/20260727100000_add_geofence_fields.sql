-- ============================================================
-- Migration: 20260727100000_add_geofence_fields
-- Adds GPS geofence auto-confirm tracking columns to orders.
-- drop_lat / drop_lng already exist in production data via the
-- order creation payload — these are added as nullable to be
-- backward-compatible, then backfilled from load_offers.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS geofence_confirmed        boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS geofence_confirmed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS geofence_driver_lat       numeric(9,6),
  ADD COLUMN IF NOT EXISTS geofence_driver_lng       numeric(9,6);

-- If drop_lat / drop_lng do not exist yet, add them.
-- (They are included in the createOrder payload but may not be
--  in the schema if a prior migration was missed.)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS drop_lat  numeric(9,6),
  ADD COLUMN IF NOT EXISTS drop_lng  numeric(9,6);

-- Index for fast geofence queries by order status.
CREATE INDEX IF NOT EXISTS idx_orders_geofence_status
  ON orders (status, geofence_confirmed)
  WHERE geofence_confirmed = false;

COMMENT ON COLUMN orders.geofence_confirmed      IS 'True when driver GPS was ≤500m from drop, triggering auto-confirm';
COMMENT ON COLUMN orders.geofence_confirmed_at   IS 'Timestamp of geofence auto-confirm trigger';
COMMENT ON COLUMN orders.geofence_driver_lat     IS 'Driver latitude at moment of geofence confirm';
COMMENT ON COLUMN orders.geofence_driver_lng     IS 'Driver longitude at moment of geofence confirm';
