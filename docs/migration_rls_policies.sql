-- Migration: Row Level Security Policies
-- ============================================================================
-- Idempotent RLS policies for protected tables.
-- These policies ensure users can only access their own data, while the
-- backend service_role key retains full access.
--
-- APPLYING:
--   psql -f docs/migration_rls_policies.sql
--   Or paste into Supabase SQL Editor.
--
-- Prerequisites:
--   The get_profile_id() helper function must exist (defined in supabase_setup.sql).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: Ensure RLS is enabled on each table (idempotent)
-- ────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  -- Enable RLS on tables (safe to call multiple times)
  EXECUTE 'ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS driver_details ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS orders ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS order_timeline ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS load_offers ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS load_bids ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS trips ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS trip_stops ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS driver_documents ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS ratings ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS user_devices ENABLE ROW LEVEL SECURITY';
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. PROFILES
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on profiles" ON profiles;
CREATE POLICY "Service role full access on profiles"
  ON profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users select own profile" ON profiles;
CREATE POLICY "Users select own profile"
  ON profiles FOR SELECT TO authenticated
  USING (firebase_uid = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (firebase_uid = (auth.jwt() ->> 'sub'))
  WITH CHECK (firebase_uid = (auth.jwt() ->> 'sub'));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. DRIVER DETAILS
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on driver_details" ON driver_details;
CREATE POLICY "Service role full access on driver_details"
  ON driver_details FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers access own driver_details" ON driver_details;
CREATE POLICY "Drivers access own driver_details"
  ON driver_details FOR ALL TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());

-- ────────────────────────────────────────────────────────────────────────────
-- 3. ORDERS
-- ────────────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────────────
-- 4. ORDER TIMELINE
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on order_timeline" ON order_timeline;
CREATE POLICY "Service role full access on order_timeline"
  ON order_timeline FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users view timeline for their orders" ON order_timeline;
CREATE POLICY "Users view timeline for their orders"
  ON order_timeline FOR SELECT TO authenticated
  USING (
    order_display_id IN (
      SELECT order_display_id FROM orders
      WHERE customer_id = get_profile_id() OR driver_id = get_profile_id()
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 5. LOAD OFFERS
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on load_offers" ON load_offers;
CREATE POLICY "Service role full access on load_offers"
  ON load_offers FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users view available load offers" ON load_offers;
CREATE POLICY "Authenticated users view available load offers"
  ON load_offers FOR SELECT TO authenticated
  USING (status = 'available' OR customer_id = get_profile_id());

DROP POLICY IF EXISTS "Customers manage own load offers" ON load_offers;
CREATE POLICY "Customers manage own load offers"
  ON load_offers FOR INSERT TO authenticated
  WITH CHECK (customer_id = get_profile_id());

-- ────────────────────────────────────────────────────────────────────────────
-- 6. LOAD BIDS
-- ────────────────────────────────────────────────────────────────────────────
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
  USING (
    load_id IN (SELECT id FROM load_offers WHERE customer_id = get_profile_id())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 7. TRIPS
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on trips" ON trips;
CREATE POLICY "Service role full access on trips"
  ON trips FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers access own trips" ON trips;
CREATE POLICY "Drivers access own trips"
  ON trips FOR ALL TO authenticated
  USING (driver_id = get_profile_id())
  WITH CHECK (driver_id = get_profile_id());

-- ────────────────────────────────────────────────────────────────────────────
-- 8. TRIP STOPS
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on trip_stops" ON trip_stops;
CREATE POLICY "Service role full access on trip_stops"
  ON trip_stops FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers view own trip stops" ON trip_stops;
CREATE POLICY "Drivers view own trip stops"
  ON trip_stops FOR SELECT TO authenticated
  USING (
    trip_display_id IN (SELECT trip_display_id FROM trips WHERE driver_id = get_profile_id())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 9. NOTIFICATIONS
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on notifications" ON notifications;
CREATE POLICY "Service role full access on notifications"
  ON notifications FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own notifications" ON notifications;
CREATE POLICY "Users access own notifications"
  ON notifications FOR ALL TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());

-- ────────────────────────────────────────────────────────────────────────────
-- 10. DRIVER DOCUMENTS
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS driver_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on driver_documents" ON driver_documents;
CREATE POLICY "Service role full access on driver_documents"
  ON driver_documents FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers access own documents" ON driver_documents;
CREATE POLICY "Drivers access own documents"
  ON driver_documents FOR ALL TO authenticated
  USING (driver_id = get_profile_id())
  WITH CHECK (driver_id = get_profile_id());

-- ────────────────────────────────────────────────────────────────────────────
-- 11. RATINGS
-- ────────────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────────────
-- 12. USER DEVICES
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on user_devices" ON user_devices;
CREATE POLICY "Service role full access on user_devices"
  ON user_devices FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own user_devices" ON user_devices;
CREATE POLICY "Users access own user_devices"
  ON user_devices FOR ALL TO authenticated
  USING (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());

-- ────────────────────────────────────────────────────────────────────────────
-- 13. DRIVER LOCATIONS  (real-time GPS coordinates)
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY: Each driver can only access their own location data.
-- Admins can access all locations for dispatch operations.
-- This prevents the vulnerability where any authenticated driver could query
-- other drivers' real-time locations.

ALTER TABLE IF EXISTS driver_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on driver_locations" ON driver_locations;
CREATE POLICY "Service role full access on driver_locations"
  ON driver_locations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers select own location" ON driver_locations;
CREATE POLICY "Drivers select own location"
  ON driver_locations FOR SELECT TO authenticated
  USING (driver_id = get_profile_id());

DROP POLICY IF EXISTS "Drivers update own location" ON driver_locations;
CREATE POLICY "Drivers update own location"
  ON driver_locations FOR UPDATE TO authenticated
  USING (driver_id = get_profile_id())
  WITH CHECK (driver_id = get_profile_id());

DROP POLICY IF EXISTS "Drivers insert own location" ON driver_locations;
CREATE POLICY "Drivers insert own location"
  ON driver_locations FOR INSERT TO authenticated
  WITH CHECK (driver_id = get_profile_id());

DROP POLICY IF EXISTS "Admins select all driver locations" ON driver_locations;
CREATE POLICY "Admins select all driver locations"
  ON driver_locations FOR SELECT TO authenticated
  USING ((SELECT role FROM profiles WHERE id = get_profile_id()) = 'admin');

DROP POLICY IF EXISTS "Admins can update driver locations" ON driver_locations;
CREATE POLICY "Admins can update driver locations"
  ON driver_locations FOR UPDATE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = get_profile_id()) = 'admin');
