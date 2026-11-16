-- Migration: Create road_grip_reports table for road condition telemetry
-- Resolves Issue #9569: /api/road-conditions queries road_grip_reports table that no migration creates
--
-- This table stores crowd-sourced telemetry reports on road surface grip levels,
-- micro-slip events, and geospatial coordinates to warn drivers of hazardous conditions.

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create the road_grip_reports table
CREATE TABLE IF NOT EXISTS public.road_grip_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
    grip_index NUMERIC NOT NULL CHECK (grip_index >= 0 AND grip_index <= 10),
    slip_events_count INT NOT NULL DEFAULT 0 CHECK (slip_events_count >= 0),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create indexes for efficient road-condition queries
-- Composite index for bounding box and time-window queries (lat/lng range + recency order)
CREATE INDEX IF NOT EXISTS idx_road_grip_reports_coords_recorded
    ON public.road_grip_reports (latitude, longitude, recorded_at DESC);

-- Index for ordering / filtering by recency
CREATE INDEX IF NOT EXISTS idx_road_grip_reports_recorded_at
    ON public.road_grip_reports (recorded_at DESC);

-- Index for foreign key lookups by user_id
CREATE INDEX IF NOT EXISTS idx_road_grip_reports_user_id
    ON public.road_grip_reports (user_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.road_grip_reports ENABLE ROW LEVEL SECURITY;

-- Policy 1: Authenticated users can read road grip reports (crowdsourced telemetry for route safety)
DROP POLICY IF EXISTS "Authenticated users can read road grip reports" ON public.road_grip_reports;
CREATE POLICY "Authenticated users can read road grip reports"
    ON public.road_grip_reports
    FOR SELECT TO authenticated
    USING (true);

-- Policy 2: Authenticated users can insert their own road grip reports
DROP POLICY IF EXISTS "Authenticated users can insert road grip reports" ON public.road_grip_reports;
CREATE POLICY "Authenticated users can insert road grip reports"
    ON public.road_grip_reports
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Policy 3: Service role has full access
DROP POLICY IF EXISTS "Service role full access on road_grip_reports" ON public.road_grip_reports;
CREATE POLICY "Service role full access on road_grip_reports"
    ON public.road_grip_reports
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- 5. Revoke excessive privileges from anon role
REVOKE ALL ON TABLE public.road_grip_reports FROM anon;
