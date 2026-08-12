-- Fix #7535: add geofence auto-confirm tracking columns to orders.
-- deliveryVerificationService writes geofence_confirmed / geofence_confirmed_at /
-- geofence_driver_lat / geofence_driver_lng, which previously failed with PGRST204.
-- (Previously only defined in the unapplied docs/supabase/migrations/20260727100000_add_geofence_fields.sql.)
alter table orders
  add column if not exists geofence_confirmed    boolean     not null default false,
  add column if not exists geofence_confirmed_at timestamptz,
  add column if not exists geofence_driver_lat   numeric(9,6),
  add column if not exists geofence_driver_lng   numeric(9,6);

create index if not exists idx_orders_geofence_status
  on orders (status, geofence_confirmed)
  where geofence_confirmed = false;
