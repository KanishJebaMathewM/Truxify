-- ============================================================================
-- Migration: 002_rls_policies.sql
-- Row Level Security Policies for All Protected Tables
-- ============================================================================
-- Idempotent RLS policies for all user-facing tables.
-- These policies ensure authenticated users can only access their own data,
-- while the backend service_role key retains full unrestricted access.
--
-- APPLYING:
--   psql -f docs/supabase/migrations/002_rls_policies.sql
--   Or paste into Supabase SQL Editor.
--
-- Prerequisites:
--   The get_profile_id() helper function must exist (defined in supabase_setup.sql):
--
--     CREATE OR REPLACE FUNCTION get_profile_id()
--     RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
--       SELECT id FROM profiles WHERE firebase_uid = (auth.jwt() ->> 'sub') LIMIT 1;
--     $$;
--
-- ARCHITECTURE:
--   • Backend API uses SUPABASE_SERVICE_ROLE_KEY → bypasses RLS (full access).
--   • Flutter apps use SUPABASE_ANON_KEY + authenticated session → hits RLS.
--   • RLS policies restrict authenticated client-side queries to own-data only.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: Enable RLS on all protected tables (idempotent)
-- ────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  EXECUTE 'ALTER TABLE IF EXISTS profiles          ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS driver_details    ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS orders            ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS order_timeline    ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS load_offers       ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS load_bids         ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS trips             ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS trip_stops        ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS notifications     ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS documents         ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS ratings           ENABLE ROW LEVEL SECURITY';
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PROFILES
--    Identity column: firebase_uid (matched against auth.jwt() ->> 'sub')
-- ────────────────────────────────────────────────────────────────────────────
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
  USING  (firebase_uid = (auth.jwt() ->> 'sub'))
  WITH CHECK (firebase_uid = (auth.jwt() ->> 'sub'));


-- ────────────────────────────────────────────────────────────────────────────
-- 2. DRIVER DETAILS
--    Identity column: user_id (profiles.id)
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on driver_details" ON driver_details;
CREATE POLICY "Service role full access on driver_details"
  ON driver_details FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers access own driver_details" ON driver_details;
CREATE POLICY "Drivers access own driver_details"
  ON driver_details FOR ALL TO authenticated
  USING  (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());


-- ────────────────────────────────────────────────────────────────────────────
-- 3. ORDERS
--    Customers own their orders; drivers can view orders assigned to them.
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on orders" ON orders;
CREATE POLICY "Service role full access on orders"
  ON orders FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Customers access own orders" ON orders;
CREATE POLICY "Customers access own orders"
  ON orders FOR ALL TO authenticated
  USING  (customer_id = get_profile_id())
  WITH CHECK (customer_id = get_profile_id());

DROP POLICY IF EXISTS "Drivers view assigned orders" ON orders;
CREATE POLICY "Drivers view assigned orders"
  ON orders FOR SELECT TO authenticated
  USING (driver_id = get_profile_id());


-- ────────────────────────────────────────────────────────────────────────────
-- 4. ORDER TIMELINE
--    Visible to both the customer and the assigned driver for an order.
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
--    Available offers are visible to all authenticated users (load board).
--    Only the owning customer can insert or update their offers.
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on load_offers" ON load_offers;
CREATE POLICY "Service role full access on load_offers"
  ON load_offers FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users view available load offers" ON load_offers;
CREATE POLICY "Authenticated users view available load offers"
  ON load_offers FOR SELECT TO authenticated
  USING (status = 'available' OR customer_id = get_profile_id());

DROP POLICY IF EXISTS "Customers insert own load offers" ON load_offers;
CREATE POLICY "Customers insert own load offers"
  ON load_offers FOR INSERT TO authenticated
  WITH CHECK (customer_id = get_profile_id());

DROP POLICY IF EXISTS "Customers update own load offers" ON load_offers;
CREATE POLICY "Customers update own load offers"
  ON load_offers FOR UPDATE TO authenticated
  USING  (customer_id = get_profile_id())
  WITH CHECK (customer_id = get_profile_id());


-- ────────────────────────────────────────────────────────────────────────────
-- 6. LOAD BIDS
--    Drivers own their bids; customers can view bids on their own offers.
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on load_bids" ON load_bids;
CREATE POLICY "Service role full access on load_bids"
  ON load_bids FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers access own bids" ON load_bids;
CREATE POLICY "Drivers access own bids"
  ON load_bids FOR ALL TO authenticated
  USING  (driver_id = get_profile_id())
  WITH CHECK (driver_id = get_profile_id());

DROP POLICY IF EXISTS "Customers view bids on own load offers" ON load_bids;
CREATE POLICY "Customers view bids on own load offers"
  ON load_bids FOR SELECT TO authenticated
  USING (
    load_id IN (SELECT id FROM load_offers WHERE customer_id = get_profile_id())
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 7. TRIPS
--    Drivers have full access to their own trips only.
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on trips" ON trips;
CREATE POLICY "Service role full access on trips"
  ON trips FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers access own trips" ON trips;
CREATE POLICY "Drivers access own trips"
  ON trips FOR ALL TO authenticated
  USING  (driver_id = get_profile_id())
  WITH CHECK (driver_id = get_profile_id());


-- ────────────────────────────────────────────────────────────────────────────
-- 8. TRIP STOPS
--    Drivers can view and update stops on their own trips.
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

DROP POLICY IF EXISTS "Drivers update own trip stops" ON trip_stops;
CREATE POLICY "Drivers update own trip stops"
  ON trip_stops FOR UPDATE TO authenticated
  USING (
    trip_display_id IN (SELECT trip_display_id FROM trips WHERE driver_id = get_profile_id())
  )
  WITH CHECK (
    trip_display_id IN (SELECT trip_display_id FROM trips WHERE driver_id = get_profile_id())
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 9. NOTIFICATIONS
--    Users can only access their own notification records.
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on notifications" ON notifications;
CREATE POLICY "Service role full access on notifications"
  ON notifications FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own notifications" ON notifications;
CREATE POLICY "Users access own notifications"
  ON notifications FOR ALL TO authenticated
  USING  (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());


-- ────────────────────────────────────────────────────────────────────────────
-- 10. DOCUMENTS  (driver KYC documents — table name is `documents` in schema)
--     Drivers can view and update their own documents only.
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on documents" ON documents;
CREATE POLICY "Service role full access on documents"
  ON documents FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own documents" ON documents;
CREATE POLICY "Users access own documents"
  ON documents FOR ALL TO authenticated
  USING  (user_id = get_profile_id())
  WITH CHECK (user_id = get_profile_id());


-- ────────────────────────────────────────────────────────────────────────────
-- 11. RATINGS
--     Customers manage their own ratings; drivers can read ratings about them.
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on ratings" ON ratings;
CREATE POLICY "Service role full access on ratings"
  ON ratings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Customers manage own ratings" ON ratings;
CREATE POLICY "Customers manage own ratings"
  ON ratings FOR ALL TO authenticated
  USING  (customer_id = get_profile_id())
  WITH CHECK (customer_id = get_profile_id());

DROP POLICY IF EXISTS "Drivers view ratings about themselves" ON ratings;
CREATE POLICY "Drivers view ratings about themselves"
  ON ratings FOR SELECT TO authenticated
  USING (driver_id = get_profile_id());

COMMIT;
