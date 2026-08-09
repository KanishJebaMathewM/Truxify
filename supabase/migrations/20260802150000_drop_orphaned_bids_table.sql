-- Drop the orphaned `bids` table and `bid_status` enum (Issue #5784).
--
-- 20260730120000_create_bids_table.sql created `public.bids` and the
-- `bid_status` enum with RLS policies, but the application never uses them:
-- every production query and `accept_bid_tx` operate on `load_bids` (see
-- orderValidationService.js:107, driverRoutes.js:875, orderRepository.js,
-- and 20260628000000_add_rpc_functions.sql:48-55).  Keeping two competing
-- bid tables is a source of truth / schema drift hazard.
--
-- This migration removes the orphaned objects so `load_bids` remains the
-- single source of truth for the bid flow.  RLS policies attached to the
-- table are dropped automatically with it.

DROP TABLE IF EXISTS public.bids;

DROP TYPE IF EXISTS public.bid_status;
