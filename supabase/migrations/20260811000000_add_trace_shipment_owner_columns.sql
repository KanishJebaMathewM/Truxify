-- ============================================================================
-- TRACEABILITY — Shipment Owner Columns
-- ============================================================================
-- `TraceabilityService.verifyShipmentOwnership` selects `user_id` and
-- `allowed_users` from `trace_shipments` (backend/traceability/trace.service.js)
-- as a DB-level ownership fallback. The original traceability migration
-- (20260806040000_create_traceability_tables.sql) never created those columns,
-- so the select errored and the fallback silently denied every non-admin.
-- This migration adds them, keeping the table aligned with the select shape.
-- ============================================================================

alter table trace_shipments
  add column if not exists user_id       text,    -- verifyShipmentOwnership: dbShipment.user_id
  add column if not exists allowed_users jsonb not null default '[]'::jsonb; -- verifyShipmentOwnership: dbShipment.allowed_users
