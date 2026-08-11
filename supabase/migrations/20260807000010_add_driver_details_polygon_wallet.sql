-- Fix #7532: add missing polygon_wallet_address column to driver_details.
-- orderRepository, driverRoutes, profileRoutes and bidAcceptanceService read/write
-- driver_details.polygon_wallet_address, which previously failed with PGRST204.
alter table driver_details
  add column if not exists polygon_wallet_address text;
