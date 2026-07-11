-- Resolves #2413: security(supabase): configure strict Row Level Security (RLS) policies
-- ------------------------------------------------------------------------------
-- This is the definitive RLS migration covering every user-facing table in the
-- Truxify Supabase schema. Policies use the get_profile_id() helper (maps JWT
-- sub to profiles.id) for ownership scoping.
--
-- Principle: service_role bypasses RLS (backend API use), authenticated users
-- see only their own data via narrow ownership/involvement policies.
-- Public reference tables (faqs, vehicle_types, regions) allow anon SELECT.
-- ------------------------------------------------------------------------------

-- ─── Helper: map Firebase JWT sub → profiles.id ───
CREATE OR REPLACE FUNCTION get_profile_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT id FROM profiles WHERE firebase_uid = (auth.jwt() ->> 'sub') LIMIT 1;
$$;


-- ─── PROFILES ───
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on profiles" ON profiles;
CREATE POLICY "Service role full access on profiles"
  ON profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users select own profile" ON profiles;
CREATE POLICY "Users select own profile"
  ON profiles FOR SELECT TO authenticated
  USING (firebase_uid = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users insert own profile" ON profiles;
CREATE POLICY "Users insert own profile"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (firebase_uid = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (firebase_uid = (auth.jwt() ->> 'sub'))
  WITH CHECK (firebase_uid = (auth.jwt() ->> 'sub'));


-- ─── DRIVER DETAILS ───
ALTER TABLE IF EXISTS driver_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on driver_details" ON driver_details;
CREATE POLICY "Service role full access on driver_details"
  ON driver_details FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers access own driver_details" ON driver_details;
CREATE POLICY "Drivers access own driver_details"
  ON driver_details FOR ALL TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());


-- ─── CUSTOMER STATS ───
ALTER TABLE IF EXISTS customer_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on customer_stats" ON customer_stats;
CREATE POLICY "Service role full access on customer_stats"
  ON customer_stats FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Customers access own stats" ON customer_stats;
CREATE POLICY "Customers access own stats"
  ON customer_stats FOR ALL TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());


-- ─── TRUCKS ───
ALTER TABLE IF EXISTS trucks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on trucks" ON trucks;
CREATE POLICY "Service role full access on trucks"
  ON trucks FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers access own trucks" ON trucks;
CREATE POLICY "Drivers access own trucks"
  ON trucks FOR ALL TO authenticated
  USING (driver_id = get_profile_id())
  WITH CHECK (driver_id = get_profile_id());


-- ─── TYRE DIAGNOSTICS ───
ALTER TABLE IF EXISTS tyre_diagnostics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on tyre_diagnostics" ON tyre_diagnostics;
CREATE POLICY "Service role full access on tyre_diagnostics"
  ON tyre_diagnostics FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers view own tyre diagnostics" ON tyre_diagnostics;
CREATE POLICY "Drivers view own tyre diagnostics"
  ON tyre_diagnostics FOR SELECT TO authenticated
  USING (truck_id IN (SELECT id FROM trucks WHERE driver_id = get_profile_id()));


-- ─── TRUCK MAINTENANCE TICKETS ───
ALTER TABLE IF EXISTS truck_maintenance_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on truck_maintenance_tickets" ON truck_maintenance_tickets;
CREATE POLICY "Service role full access on truck_maintenance_tickets"
  ON truck_maintenance_tickets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers access own maintenance tickets" ON truck_maintenance_tickets;
CREATE POLICY "Drivers access own maintenance tickets"
  ON truck_maintenance_tickets FOR ALL TO authenticated
  USING (driver_id = get_profile_id())
  WITH CHECK (driver_id = get_profile_id());


-- ─── SAVED ADDRESSES ───
ALTER TABLE IF EXISTS saved_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on saved_addresses" ON saved_addresses;
CREATE POLICY "Service role full access on saved_addresses"
  ON saved_addresses FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own saved addresses" ON saved_addresses;
CREATE POLICY "Users access own saved addresses"
  ON saved_addresses FOR ALL TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());


-- ─── PAYMENT METHODS ───
ALTER TABLE IF EXISTS payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on payment_methods" ON payment_methods;
CREATE POLICY "Service role full access on payment_methods"
  ON payment_methods FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own payment methods" ON payment_methods;
CREATE POLICY "Users access own payment methods"
  ON payment_methods FOR ALL TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());


-- ─── DOCUMENTS ───
ALTER TABLE IF EXISTS documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on documents" ON documents;
CREATE POLICY "Service role full access on documents"
  ON documents FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own documents" ON documents;
CREATE POLICY "Users access own documents"
  ON documents FOR ALL TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());


-- ─── ORDERS ───
ALTER TABLE IF EXISTS orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on orders" ON orders;
CREATE POLICY "Service role full access on orders"
  ON orders FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Customers access own orders" ON orders;
CREATE POLICY "Customers access own orders"
  ON orders FOR ALL TO authenticated
  USING (customer_id = get_profile_id())
  WITH CHECK (customer_id = get_profile_id());

DROP POLICY IF EXISTS "Drivers view assigned orders" ON orders;
CREATE POLICY "Drivers view assigned orders"
  ON orders FOR SELECT TO authenticated
  USING (driver_id = get_profile_id());


-- ─── ORDER TIMELINE ───
ALTER TABLE IF EXISTS order_timeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on order_timeline" ON order_timeline;
CREATE POLICY "Service role full access on order_timeline"
  ON order_timeline FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users view timeline for their orders" ON order_timeline;
CREATE POLICY "Users view timeline for their orders"
  ON order_timeline FOR SELECT TO authenticated
  USING (order_display_id IN (
    SELECT order_display_id FROM orders
    WHERE customer_id = get_profile_id() OR driver_id = get_profile_id()
  ));


-- ─── LOAD OFFERS ───
ALTER TABLE IF EXISTS load_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on load_offers" ON load_offers;
CREATE POLICY "Service role full access on load_offers"
  ON load_offers FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users view load offers" ON load_offers;
CREATE POLICY "Authenticated users view load offers"
  ON load_offers FOR SELECT TO authenticated
  USING (status = 'available' OR customer_id = get_profile_id());

DROP POLICY IF EXISTS "Customers insert own load offers" ON load_offers;
CREATE POLICY "Customers insert own load offers"
  ON load_offers FOR INSERT TO authenticated
  WITH CHECK (customer_id = get_profile_id());

DROP POLICY IF EXISTS "Customers update own load offers" ON load_offers;
CREATE POLICY "Customers update own load offers"
  ON load_offers FOR UPDATE TO authenticated
  USING (customer_id = get_profile_id())
  WITH CHECK (customer_id = get_profile_id());


-- ─── LOAD BIDS ───
ALTER TABLE IF EXISTS load_bids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on load_bids" ON load_bids;
CREATE POLICY "Service role full access on load_bids"
  ON load_bids FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers access own bids" ON load_bids;
CREATE POLICY "Drivers access own bids"
  ON load_bids FOR ALL TO authenticated
  USING (driver_id = get_profile_id())
  WITH CHECK (driver_id = get_profile_id());

DROP POLICY IF EXISTS "Customers view bids on own load offers" ON load_bids;
CREATE POLICY "Customers view bids on own load offers"
  ON load_bids FOR SELECT TO authenticated
  USING (load_id IN (SELECT id FROM load_offers WHERE customer_id = get_profile_id()));


-- ─── TRIPS ───
ALTER TABLE IF EXISTS trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on trips" ON trips;
CREATE POLICY "Service role full access on trips"
  ON trips FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers access own trips" ON trips;
CREATE POLICY "Drivers access own trips"
  ON trips FOR ALL TO authenticated
  USING (driver_id = get_profile_id())
  WITH CHECK (driver_id = get_profile_id());


-- ─── TRIP ITEMS ───
ALTER TABLE IF EXISTS trip_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on trip_items" ON trip_items;
CREATE POLICY "Service role full access on trip_items"
  ON trip_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers view own trip items" ON trip_items;
CREATE POLICY "Drivers view own trip items"
  ON trip_items FOR SELECT TO authenticated
  USING (trip_display_id IN (SELECT trip_display_id FROM trips WHERE driver_id = get_profile_id()));


-- ─── TRIP STOPS ───
ALTER TABLE IF EXISTS trip_stops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on trip_stops" ON trip_stops;
CREATE POLICY "Service role full access on trip_stops"
  ON trip_stops FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers view own trip stops" ON trip_stops;
CREATE POLICY "Drivers view own trip stops"
  ON trip_stops FOR SELECT TO authenticated
  USING (trip_display_id IN (SELECT trip_display_id FROM trips WHERE driver_id = get_profile_id()));

DROP POLICY IF EXISTS "Drivers update own trip stops" ON trip_stops;
CREATE POLICY "Drivers update own trip stops"
  ON trip_stops FOR UPDATE TO authenticated
  USING (trip_display_id IN (SELECT trip_display_id FROM trips WHERE driver_id = get_profile_id()))
  WITH CHECK (trip_display_id IN (SELECT trip_display_id FROM trips WHERE driver_id = get_profile_id()));


-- ─── ROUTE MAP POINTS ───
ALTER TABLE IF EXISTS route_map_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on route_map_points" ON route_map_points;
CREATE POLICY "Service role full access on route_map_points"
  ON route_map_points FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers view own route map points" ON route_map_points;
CREATE POLICY "Drivers view own route map points"
  ON route_map_points FOR SELECT TO authenticated
  USING (trip_display_id IN (SELECT trip_display_id FROM trips WHERE driver_id = get_profile_id()));


-- ─── RATINGS ───
ALTER TABLE IF EXISTS ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on ratings" ON ratings;
CREATE POLICY "Service role full access on ratings"
  ON ratings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Customers manage own ratings" ON ratings;
CREATE POLICY "Customers manage own ratings"
  ON ratings FOR ALL TO authenticated
  USING (customer_id = get_profile_id())
  WITH CHECK (customer_id = get_profile_id());

DROP POLICY IF EXISTS "Drivers view ratings about themselves" ON ratings;
CREATE POLICY "Drivers view ratings about themselves"
  ON ratings FOR SELECT TO authenticated
  USING (driver_id = get_profile_id());


-- ─── WALLET TRANSACTIONS ───
ALTER TABLE IF EXISTS wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on wallet_transactions" ON wallet_transactions;
CREATE POLICY "Service role full access on wallet_transactions"
  ON wallet_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers view own wallet transactions" ON wallet_transactions;
CREATE POLICY "Drivers view own wallet transactions"
  ON wallet_transactions FOR SELECT TO authenticated
  USING (driver_id = get_profile_id());


-- ─── PROCESSED BATCHES ───
ALTER TABLE IF EXISTS processed_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on processed_batches" ON processed_batches;
CREATE POLICY "Service role full access on processed_batches"
  ON processed_batches FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users view own processed batches" ON processed_batches;
CREATE POLICY "Users view own processed batches"
  ON processed_batches FOR SELECT TO authenticated
  USING (user_id = get_profile_id());


-- ─── DEMAND ROUTES (public reference) ───
ALTER TABLE IF EXISTS demand_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on demand_routes" ON demand_routes;
CREATE POLICY "Service role full access on demand_routes"
  ON demand_routes FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users view active demand routes" ON demand_routes;
CREATE POLICY "Authenticated users view active demand routes"
  ON demand_routes FOR SELECT TO authenticated
  USING (is_active = true);


-- ─── NOTIFICATIONS ───
ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on notifications" ON notifications;
CREATE POLICY "Service role full access on notifications"
  ON notifications FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own notifications" ON notifications;
CREATE POLICY "Users access own notifications"
  ON notifications FOR ALL TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());


-- ─── FAQS (public reference) ───
ALTER TABLE IF EXISTS faqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on faqs" ON faqs;
CREATE POLICY "Service role full access on faqs"
  ON faqs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can view active FAQs" ON faqs;
CREATE POLICY "Anyone can view active FAQs"
  ON faqs FOR SELECT TO anon, authenticated
  USING (is_active = true);


-- ─── SUPPORT TICKETS ───
ALTER TABLE IF EXISTS support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on support_tickets" ON support_tickets;
CREATE POLICY "Service role full access on support_tickets"
  ON support_tickets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own support tickets" ON support_tickets;
CREATE POLICY "Users access own support tickets"
  ON support_tickets FOR ALL TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());


-- ─── EARNINGS DAILY ───
ALTER TABLE IF EXISTS earnings_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on earnings_daily" ON earnings_daily;
CREATE POLICY "Service role full access on earnings_daily"
  ON earnings_daily FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers view own earnings daily" ON earnings_daily;
CREATE POLICY "Drivers view own earnings daily"
  ON earnings_daily FOR SELECT TO authenticated
  USING (driver_id = get_profile_id());


-- ─── DELIVERY OTPs ───
ALTER TABLE IF EXISTS delivery_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on delivery_otps" ON delivery_otps;
CREATE POLICY "Service role full access on delivery_otps"
  ON delivery_otps FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Customers view own delivery OTPs" ON delivery_otps;
CREATE POLICY "Customers view own delivery OTPs"
  ON delivery_otps FOR SELECT TO authenticated
  USING (order_id IN (SELECT id FROM orders WHERE customer_id = get_profile_id()));

DROP POLICY IF EXISTS "Drivers cannot select delivery OTPs" ON delivery_otps;
CREATE POLICY "Drivers cannot select delivery OTPs"
  ON delivery_otps FOR SELECT TO authenticated
  USING (false);

DROP POLICY IF EXISTS "service_insert_delivery_otp" ON delivery_otps;
CREATE POLICY "service_insert_delivery_otp"
  ON delivery_otps FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_update_delivery_otp" ON delivery_otps;
CREATE POLICY "service_update_delivery_otp"
  ON delivery_otps FOR UPDATE TO service_role
  USING (true) WITH CHECK (true);


-- ─── DRIVER LOCATIONS ───
ALTER TABLE IF EXISTS driver_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on driver_locations" ON driver_locations;
CREATE POLICY "Service role full access on driver_locations"
  ON driver_locations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers select own location" ON driver_locations;
CREATE POLICY "Drivers select own location"
  ON driver_locations FOR SELECT TO authenticated
  USING (driver_id = get_profile_id());

DROP POLICY IF EXISTS "Drivers insert own location" ON driver_locations;
CREATE POLICY "Drivers insert own location"
  ON driver_locations FOR INSERT TO authenticated
  WITH CHECK (driver_id = get_profile_id());

DROP POLICY IF EXISTS "Drivers update own location" ON driver_locations;
CREATE POLICY "Drivers update own location"
  ON driver_locations FOR UPDATE TO authenticated
  USING (driver_id = get_profile_id())
  WITH CHECK (driver_id = get_profile_id());


-- ─── VEHICLE TYPES (public reference) ───
ALTER TABLE IF EXISTS vehicle_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on vehicle_types" ON vehicle_types;
CREATE POLICY "Service role full access on vehicle_types"
  ON vehicle_types FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can view vehicle types" ON vehicle_types;
CREATE POLICY "Anyone can view vehicle types"
  ON vehicle_types FOR SELECT TO anon, authenticated
  USING (true);


-- ─── REGIONS (public reference) ───
ALTER TABLE IF EXISTS regions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on regions" ON regions;
CREATE POLICY "Service role full access on regions"
  ON regions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can view regions" ON regions;
CREATE POLICY "Anyone can view regions"
  ON regions FOR SELECT TO anon, authenticated
  USING (true);
