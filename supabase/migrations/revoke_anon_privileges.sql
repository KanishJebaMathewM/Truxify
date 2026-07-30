-- Revoke excessive privileges from the anon role on sensitive tables
-- This ensures unauthenticated users cannot access or modify these tables directly.
-- Extended to cover ALL user-facing tables (was previously only 4 tables).

REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.driver_details FROM anon;
REVOKE ALL ON TABLE public.customer_stats FROM anon;
REVOKE ALL ON TABLE public.trucks FROM anon;
REVOKE ALL ON TABLE public.tyre_diagnostics FROM anon;
REVOKE ALL ON TABLE public.truck_maintenance_tickets FROM anon;
REVOKE ALL ON TABLE public.saved_addresses FROM anon;
REVOKE ALL ON TABLE public.payment_methods FROM anon;
REVOKE ALL ON TABLE public.documents FROM anon;
REVOKE ALL ON TABLE public.orders FROM anon;
REVOKE ALL ON TABLE public.order_timeline FROM anon;
REVOKE ALL ON TABLE public.load_offers FROM anon;
REVOKE ALL ON TABLE public.load_bids FROM anon;
REVOKE ALL ON TABLE public.trips FROM anon;
REVOKE ALL ON TABLE public.trip_items FROM anon;
REVOKE ALL ON TABLE public.trip_stops FROM anon;
REVOKE ALL ON TABLE public.route_map_points FROM anon;
REVOKE ALL ON TABLE public.ratings FROM anon;
REVOKE ALL ON TABLE public.wallet_transactions FROM anon;
REVOKE ALL ON TABLE public.processed_batches FROM anon;
REVOKE ALL ON TABLE public.demand_routes FROM anon;
REVOKE ALL ON TABLE public.notifications FROM anon;
REVOKE ALL ON TABLE public.faqs FROM anon;
REVOKE ALL ON TABLE public.support_tickets FROM anon;
REVOKE ALL ON TABLE public.earnings_daily FROM anon;
REVOKE ALL ON TABLE public.delivery_otps FROM anon;
REVOKE ALL ON TABLE public.driver_locations FROM anon;
REVOKE ALL ON TABLE public.user_devices FROM anon;
REVOKE ALL ON TABLE public.driver_documents FROM anon;
REVOKE ALL ON TABLE public.vehicle_types FROM anon;
REVOKE ALL ON TABLE public.regions FROM anon;
REVOKE ALL ON TABLE public.webhook_failures FROM anon;
REVOKE ALL ON TABLE public.tracking_tokens FROM anon;

-- Note: RLS policies should still be enabled and strictly defined 
-- for authenticated users, but revoking from anon adds an extra layer 
-- of security for unauthenticated access.
