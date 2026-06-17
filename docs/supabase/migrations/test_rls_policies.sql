-- ============================================================================
-- RLS Policy Tests
-- docs/supabase/migrations/test_rls_policies.sql
-- ============================================================================
-- Manual verification script for Row Level Security policies.
-- Run against a local Supabase instance with two seeded test profiles:
--
--   Dev Customer: 11111111-1111-1111-1111-111111111111  (firebase_uid: 'test-customer-uid')
--   Dev Driver:   22222222-2222-2222-2222-222222222222  (firebase_uid: 'test-driver-uid')
--
-- Each block uses ROLLBACK so the DB state is unchanged after testing.
-- Expected outputs are noted in comments.
-- ============================================================================


-- ############################################################################
-- PROFILES
-- ############################################################################

-- Test 1: User can read their own profile
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-customer-uid"}';
  SELECT count(*) AS own_profile_count       -- Expected: 1
    FROM profiles WHERE firebase_uid = 'test-customer-uid';
ROLLBACK;

-- Test 2: User cannot read another user's profile
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-customer-uid"}';
  SELECT count(*) AS other_profile_count     -- Expected: 0
    FROM profiles WHERE firebase_uid = 'test-driver-uid';
ROLLBACK;

-- Test 3: User can update their own profile
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-customer-uid"}';
  UPDATE profiles SET language = 'en'
    WHERE firebase_uid = 'test-customer-uid';
  GET DIAGNOSTICS                             -- Expected: 1 row affected
    -- (check for update count = 1 in your client)
  ;
ROLLBACK;


-- ############################################################################
-- ORDERS
-- ############################################################################

-- Test 4: Customer can read their own orders
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-customer-uid"}';
  SELECT count(*) AS own_orders              -- Expected: >= 0 (own rows only)
    FROM orders WHERE customer_id = '11111111-1111-1111-1111-111111111111';
ROLLBACK;

-- Test 5: Customer cannot read another customer's orders
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-customer-uid"}';
  SELECT count(*) AS other_orders            -- Expected: 0
    FROM orders WHERE customer_id = '22222222-2222-2222-2222-222222222222';
ROLLBACK;


-- ############################################################################
-- LOAD BIDS
-- ############################################################################

-- Test 6: Driver can view their own bids
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-driver-uid"}';
  SELECT count(*) AS own_bids               -- Expected: >= 0 (own rows only)
    FROM load_bids WHERE driver_id = '22222222-2222-2222-2222-222222222222';
ROLLBACK;

-- Test 7: Driver cannot view another driver's bids
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-driver-uid"}';
  SELECT count(*) AS other_bids             -- Expected: 0 (unless linked to own load offers)
    FROM load_bids WHERE driver_id = '11111111-1111-1111-1111-111111111111';
ROLLBACK;


-- ############################################################################
-- TRIPS
-- ############################################################################

-- Test 8: Driver can view their own trips
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-driver-uid"}';
  SELECT count(*) AS own_trips              -- Expected: >= 0 (own rows only)
    FROM trips WHERE driver_id = '22222222-2222-2222-2222-222222222222';
ROLLBACK;

-- Test 9: Driver cannot view another driver's trips
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-driver-uid"}';
  SELECT count(*) AS other_trips            -- Expected: 0
    FROM trips WHERE driver_id = '11111111-1111-1111-1111-111111111111';
ROLLBACK;


-- ############################################################################
-- NOTIFICATIONS
-- ############################################################################

-- Test 10: User can view their own notifications
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-customer-uid"}';
  SELECT count(*) AS own_notifications      -- Expected: >= 0 (own rows only)
    FROM notifications WHERE user_id = '11111111-1111-1111-1111-111111111111';
ROLLBACK;

-- Test 11: User cannot view another user's notifications
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-customer-uid"}';
  SELECT count(*) AS other_notifications    -- Expected: 0
    FROM notifications WHERE user_id = '22222222-2222-2222-2222-222222222222';
ROLLBACK;


-- ############################################################################
-- DOCUMENTS (driver_documents per issue spec, actual table name: documents)
-- ############################################################################

-- Test 12: Driver can view their own documents
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-driver-uid"}';
  SELECT count(*) AS own_docs               -- Expected: >= 0 (own rows only)
    FROM documents WHERE user_id = '22222222-2222-2222-2222-222222222222';
ROLLBACK;

-- Test 13: Driver cannot view another driver's documents
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "test-driver-uid"}';
  SELECT count(*) AS other_docs             -- Expected: 0
    FROM documents WHERE user_id = '11111111-1111-1111-1111-111111111111';
ROLLBACK;
