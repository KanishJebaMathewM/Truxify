-- Create drivers table for GraphQL driver service management and location tracking
CREATE TABLE IF NOT EXISTS public.drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    current_location JSONB,
    truck_type TEXT,
    truck_number TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anyone to view drivers (enables public listings and nearby driver searches)
CREATE POLICY "Allow public read access to drivers"
    ON public.drivers
    FOR SELECT
    USING (true);

-- Policy: Allow authenticated drivers to insert their own record
CREATE POLICY "Drivers can insert their own record"
    ON public.drivers
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Allow drivers to update their own profile and location
CREATE POLICY "Drivers can update their own record"
    ON public.drivers
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Create performance indexes for lookups and filtering
CREATE INDEX IF NOT EXISTS idx_drivers_user_id ON public.drivers(user_id);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON public.drivers(status);
