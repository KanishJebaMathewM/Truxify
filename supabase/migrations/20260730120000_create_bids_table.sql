-- Create enum for bid status
CREATE TYPE public.bid_status AS ENUM ('pending', 'accepted', 'rejected', 'countered');

-- Create the bids table
CREATE TABLE IF NOT EXISTS public.bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    load_id UUID NOT NULL REFERENCES public.load_offers(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    bid_amount NUMERIC NOT NULL CHECK (bid_amount >= 0),
    status public.bid_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_bids_load_id ON public.bids(load_id);
CREATE INDEX IF NOT EXISTS idx_bids_driver_id ON public.bids(driver_id);
CREATE INDEX IF NOT EXISTS idx_bids_status ON public.bids(status);

-- Enable Row Level Security
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Drivers can only see and manage their own bids
CREATE POLICY "Drivers can view their own bids"
    ON public.bids
    FOR SELECT
    USING (get_profile_id() = driver_id);

CREATE POLICY "Drivers can insert their own bids"
    ON public.bids
    FOR INSERT
    WITH CHECK (get_profile_id() = driver_id);

CREATE POLICY "Drivers can update their own pending bids"
    ON public.bids
    FOR UPDATE
    USING (get_profile_id() = driver_id AND status = 'pending')
    WITH CHECK (get_profile_id() = driver_id);

-- RLS Policy: Customers can view bids placed on their loads
-- (Assumes load_offers table has a customer_id column linking to the creator)
CREATE POLICY "Customers can view bids on their loads"
    ON public.bids
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.load_offers lo 
            WHERE lo.id = bids.load_id 
            AND lo.customer_id = get_profile_id()
        )
    );

-- RLS Policy: Customers can accept or reject bids on their loads
CREATE POLICY "Customers can update bids on their loads"
    ON public.bids
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.load_offers lo 
            WHERE lo.id = bids.load_id 
            AND lo.customer_id = get_profile_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.load_offers lo 
            WHERE lo.id = bids.load_id 
            AND lo.customer_id = get_profile_id()
        )
    );
