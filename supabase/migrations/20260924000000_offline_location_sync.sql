-- Migration: 20260924000000_offline_location_sync.sql
-- Description: Adds offline location buffering and sync capabilities
-- Introduces driver_location_history for chronological trip replay and
-- deduplication of GPS updates received after network interruptions.

-- 1. Create a table to track chronological history of driver locations
CREATE TABLE IF NOT EXISTS public.driver_location_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    heading     DOUBLE PRECISION,
    speed       DOUBLE PRECISION,
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deduplication index: a driver cannot have two records at the exact same timestamp
CREATE UNIQUE INDEX IF NOT EXISTS driver_location_history_dedup_idx
    ON public.driver_location_history (driver_id, recorded_at);

-- 2. Add recorded_at to driver_locations if it doesn't exist
ALTER TABLE public.driver_locations
    ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ;

-- Backfill: set recorded_at to current time for any rows that were created
-- before this column existed (safe fallback — exact time is not critical here)
UPDATE public.driver_locations
    SET recorded_at = NOW()
    WHERE recorded_at IS NULL;

-- 3. Enable RLS for driver_location_history
ALTER TABLE public.driver_location_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers can view their own location history"
    ON public.driver_location_history;
CREATE POLICY "Drivers can view their own location history"
    ON public.driver_location_history
    FOR SELECT TO authenticated
    USING (auth.uid() = driver_id);

DROP POLICY IF EXISTS "Drivers can insert their own location history"
    ON public.driver_location_history;
CREATE POLICY "Drivers can insert their own location history"
    ON public.driver_location_history
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = driver_id);

DROP POLICY IF EXISTS "Service role full access on driver_location_history"
    ON public.driver_location_history;
CREATE POLICY "Service role full access on driver_location_history"
    ON public.driver_location_history
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- Deny anonymous access to location history
REVOKE ALL ON TABLE public.driver_location_history FROM anon;
