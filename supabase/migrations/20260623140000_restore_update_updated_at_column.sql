-- Migration: Restore update_updated_at_column() trigger function
-- ---------------------------------------------------------------------------
-- Historical migrations 20260623142000 (user_devices) and 20260702000000
-- (driver_documents) create BEFORE UPDATE triggers that call
-- update_updated_at_column(), but no migration ever created that function.
-- A later migration (20260707000000) creates set_updated_at() with identical
-- behaviour for the profiles and orders tables.
--
-- On a fresh database (supabase db reset), applying migration
-- 20260623142000 fails with:
--   function update_updated_at_column() does not exist
--
-- This migration is timestamped BEFORE the first broken migration so that
-- the function exists when 20260623142000 and 20260702000000 are applied.
-- It uses CREATE OR REPLACE so it is safe to re-run and harmless on
-- existing deployments where the function already exists (e.g. created via
-- supabase_setup.sql).  No existing triggers, tables, or APIs are changed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.update_updated_at_column() IS
  'Trigger function that auto-sets updated_at on row updates. '
  'Restores the function referenced by migrations 20260623142000 and 20260702000000.';
