-- ============================================================================
-- TRUXIFY — SUPABASE / POSTGRESQL REFERENCE QUERIES
-- ============================================================================
--
-- DESIGN PATTERN REMINDER:
--   - All tables are independent (no hard foreign-key constraints / wires).
--   - Relationships are linked logically via UUID or Text identifier columns.
--   - Joins are handled either via multi-query application logic (recommended for
--     scaling) or through logical equijoin filters (WHERE tableA.id = tableB.ref_id).
--   - Parameterized queries use prefix format (e.g. :user_id, :order_id).
--   - Included alongside SQL are Dart / JS SDK pseudocode concepts for context.
--
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. AUTHENTICATION & ONBOARDING FLOWS
-- ────────────────────────────────────────────────────────────────────────────

-- [Query 1.1] Fetch Profile by Firebase UID (Run on app start to check user role)
-- SQL:
SELECT id, firebase_uid, role, full_name, phone, email, company_name, avatar_url, language, dark_mode, is_active
FROM profiles
WHERE firebase_uid = :firebase_uid AND is_active = true;

-- SDK Equivalent (Dart):
-- supabase.from('profiles').select().eq('firebase_uid', firebaseUid).eq('is_active', true).maybeSingle();


-- [Query 1.2] Insert New Unified User Profile
-- SQL:
INSERT INTO profiles (firebase_uid, role, full_name, phone, email, company_name, avatar_url, language)
VALUES (:firebase_uid, :role, :full_name, :phone, :email, :company_name, :avatar_url, :language)
RETURNING id, created_at;

-- SDK Equivalent (Dart):
-- supabase.from('profiles').insert({ 'firebase_uid': uid, 'role': role, ... }).select('id, created_at').single();


-- [Query 1.3] Initialize Role-Specific Stats/Details
-- Run Query 1.3a if role is 'driver', run 1.3b if role is 'customer'.

-- Query 1.3a: Create Driver Details Record
INSERT INTO driver_details (user_id, completion_rate, rating, total_trips, wallet_confirmed, wallet_pending, wallet_total)
VALUES (:user_id, 100.00, 0.00, 0, 0, 0, 0);

-- Query 1.3b: Create Customer Stats Record
INSERT INTO customer_stats (user_id, total_orders, total_saved, co2_reduced_kg)
VALUES (:user_id, 0, 0, 0.00);


-- [Query 1.4] Retrieve Driver Documents Status
-- SQL:
SELECT id, doc_type, status, file_url, ipfs_hash, valid_until
FROM documents
WHERE user_id = :user_id
ORDER BY doc_type ASC;


-- [Query 1.5] Upload / Update Driver Document (Metadata only — files in R2)
-- SQL:
INSERT INTO documents (user_id, doc_type, status, file_url, valid_until, ipfs_hash, blockchain_hash)
VALUES (:user_id, :doc_type, 'pending', :file_url, :valid_until, :ipfs_hash, :blockchain_hash)
ON CONFLICT (id) -- If updating existing
DO UPDATE SET 
  file_url = EXCLUDED.file_url,
  status = 'pending',
  ipfs_hash = EXCLUDED.ipfs_hash,
  blockchain_hash = EXCLUDED.blockchain_hash,
  valid_until = EXCLUDED.valid_until,
  updated_at = now()
RETURNING id, status;


-- [Query 1.6] Register or Update Driver's Truck Specs
-- SQL:
INSERT INTO trucks (driver_id, name, number_plate, max_capacity_tons, cargo_length_ft, cargo_width_ft, cargo_height_ft, insurance_expiry, puc_expiry, permit_expiry)
VALUES (:driver_id, :name, :number_plate, :max_capacity_tons, :cargo_length_ft, :cargo_width_ft, :cargo_height_ft, :insurance_expiry, :puc_expiry, :permit_expiry)
RETURNING id;



-- ────────────────────────────────────────────────────────────────────────────
-- 2. CUSTOMER FLOWS: AD-HOC ADDRESSES & PAYMENTS
-- ────────────────────────────────────────────────────────────────────────────

-- [Query 2.1] Fetch Customer Saved Addresses
-- SQL:
SELECT id, label, address_line, city, state, pincode, latitude, longitude, is_default
FROM saved_addresses
WHERE user_id = :user_id
ORDER BY is_default DESC, created_at DESC;


-- [Query 2.2] Save New Address
-- SQL:
INSERT INTO saved_addresses (user_id, label, address_line, city, state, pincode, latitude, longitude, is_default)
VALUES (:user_id, :label, :address_line, :city, :state, :pincode, :latitude, :longitude, :is_default);


-- [Query 2.3] Get Default Payment Method
-- SQL:
SELECT id, method_type, display_label, provider
FROM payment_methods
WHERE user_id = :user_id AND is_default = true
LIMIT 1;



-- ────────────────────────────────────────────────────────────────────────────
-- 3. CUSTOMER BOOKING FLOW (ORDER LIFECYCLE)
-- ────────────────────────────────────────────────────────────────────────────

-- [Query 3.1] Create New Order (Customer places booking request)
-- SQL:
INSERT INTO orders (
  order_display_id, customer_id, status,
  pickup_address, pickup_lat, pickup_lng,
  drop_address, drop_lat, drop_lng,
  pickup_date, pickup_time,
  goods_type, weight_tonnes, length_ft, width_ft, height_ft,
  is_stackable, is_fragile, special_requirements,
  base_freight, toll_estimate, platform_fee, total_amount,
  payment_method_id, upi_id
) VALUES (
  :order_display_id, :customer_id, 'pending',
  :pickup_address, :pickup_lat, :pickup_lng,
  :drop_address, :drop_lat, :drop_lng,
  :pickup_date, :pickup_time,
  :goods_type, :weight_tonnes, :length_ft, :width_ft, :height_ft,
  :is_stackable, :is_fragile, :special_requirements,
  :base_freight, :toll_estimate, :platform_fee, :total_amount,
  :payment_method_id, :upi_id
) RETURNING id;


-- [Query 3.2] Initialize Order Timeline (Creates chronological milestones)
-- SQL:
INSERT INTO order_timeline (order_display_id, milestone, milestone_time, completed, sort_order)
VALUES 
  (:order_display_id, 'Order Placed', now(), true, 10),
  (:order_display_id, 'Assigning Truck', null, false, 20),
  (:order_display_id, 'En Route to Pickup', null, false, 30),
  (:order_display_id, 'Goods Loaded', null, false, 40),
  (:order_display_id, 'In Transit', null, false, 50),
  (:order_display_id, 'Delivered', null, false, 60);


-- [Query 3.3] List Customer Order History
-- SQL:
SELECT id, order_display_id, status, pickup_address, drop_address, pickup_date, total_amount, goods_type, driver_name, eta
FROM orders
WHERE customer_id = :customer_id
ORDER BY created_at DESC;


-- [Query 3.4] Fetch Specific Order Details, Timeline, & Driver Details
-- (Application layer matches order with timeline and driver stats)

-- Query 3.4a: Get Order details
SELECT id, order_display_id, driver_id, truck_id, status, pickup_address, drop_address, pickup_date, pickup_time, goods_type, weight_tonnes, total_amount, driver_name, driver_rating, truck_number, eta, blockchain_tx_hash
FROM orders
WHERE order_display_id = :order_display_id;

-- Query 3.4b: Get Milestone timeline
SELECT milestone, milestone_time, completed, sort_order
FROM order_timeline
WHERE order_display_id = :order_display_id
ORDER BY sort_order ASC;

-- Query 3.4c: Get Driver Profile metadata (if assigned)
-- No direct FK wire, fetched logically from profiles & driver_details
SELECT p.id, p.full_name, p.phone, p.avatar_url, d.rating, d.total_trips
FROM profiles p
JOIN driver_details d ON d.user_id = p.id
WHERE p.id = :assigned_driver_id;



-- ────────────────────────────────────────────────────────────────────────────
-- 4. DRIVER DISCOVERY & BIDDING LIFECYCLE
-- ────────────────────────────────────────────────────────────────────────────

-- [Query 4.1] Fetch Available Load Offers (Driver App home list)
-- Filters active offers that are 'available'. Supports en-route matching filters.
-- SQL:
SELECT id, order_display_id, customer_name, route_label, route_subtitle, pickup_address, drop_address, route_distance, route_duration, goods_type, weight, dimensions, freight_value, fuel_cost, toll_cost, net_profit, capacity_used, truck_fill_label, badge_label, badge_emoji, is_best_profit, is_en_route, extra_distance_km, extra_earnings, route_note, distance_from_driver
FROM load_offers
WHERE status = 'available'
ORDER BY created_at DESC;


-- [Query 4.2] Submit Bid on Load Offer (Driver places bid)
-- SQL:
INSERT INTO load_bids (load_id, driver_id, bid_amount, status)
VALUES (:load_id, :driver_id, :bid_amount, 'pending')
RETURNING id;


-- [Query 4.3] Customer views bids for their Load / Order
-- SQL:
SELECT b.id as bid_id, b.bid_amount, b.status, b.created_at, 
       p.id as driver_user_id, p.full_name as driver_name, p.avatar_url as driver_avatar,
       d.rating as driver_rating, d.total_trips, d.completion_rate,
       t.name as truck_name, t.number_plate as truck_plate
FROM load_bids b
JOIN profiles p ON p.id = b.driver_id
JOIN driver_details d ON d.user_id = p.id
LEFT JOIN trucks t ON t.driver_id = p.id
WHERE b.load_id = :load_id AND b.status = 'pending'
ORDER BY b.bid_amount ASC, d.rating DESC;


-- [Query 4.4] Bid Acceptance Transaction (Relational State Update)
-- To prevent race conditions, this is run inside a database transaction or RPC.
-- Step 1: Accept chosen bid.
UPDATE load_bids
SET status = 'accepted', updated_at = now()
WHERE id = :accepted_bid_id;

-- Step 2: Reject all other bids for this load.
UPDATE load_bids
SET status = 'rejected', updated_at = now()
WHERE load_id = :load_id AND id <> :accepted_bid_id;

-- Step 3: Mark load offer as claimed.
UPDATE load_offers
SET status = 'claimed', updated_at = now()
WHERE id = :load_id;

-- Step 4: Update main order status, assign driver and denormalize details.
-- (This links the customer's order to the winning driver and truck).
UPDATE orders
SET 
  driver_id = :driver_id,
  truck_id = :truck_id,
  status = 'truck_assigned',
  driver_name = :driver_name,
  driver_rating = :driver_rating,
  truck_number = :truck_number,
  updated_at = now()
WHERE order_display_id = :order_display_id;

-- Step 5: Update order timeline milestone status.
UPDATE order_timeline
SET completed = true, milestone_time = now()
WHERE order_display_id = :order_display_id AND milestone = 'Truck Assigned';



-- ────────────────────────────────────────────────────────────────────────────
-- 5. DRIVER TRIP LIFECYCLE
-- ────────────────────────────────────────────────────────────────────────────

-- [Query 5.1] Create / Start a New Trip (Driver App)
-- SQL:
INSERT INTO trips (trip_display_id, driver_id, route_label, status, trip_date, distance, duration, total_earnings, base_freight, fuel_deducted, toll_deducted, platform_fee, net_earnings)
VALUES (:trip_display_id, :driver_id, :route_label, 'active', :trip_date, :distance, :duration, :total_earnings, :base_freight, :fuel_deducted, :toll_deducted, :platform_fee, :net_earnings)
RETURNING id;


-- [Query 5.2] Add Items, Waypoints, and Map Coordinates to Trip
-- Runs for each pickup/drop location belonging to the trip.

-- Query 5.2a: Insert Trip Items (Details of what is carried)
INSERT INTO trip_items (trip_display_id, customer_name, goods, destination, earnings, is_delivered, sort_order)
VALUES (:trip_display_id, :customer_name, :goods, :destination, :earnings, false, :sort_order);

-- Query 5.2b: Insert Trip Stops (Structured roadmap stops)
INSERT INTO trip_stops (trip_display_id, customer_name, route_label, goods, drop_location, tonnes, status_label, earnings_label, sort_order, is_current, is_completed)
VALUES (:trip_display_id, :customer_name, :route_label, :goods, :drop_location, :tonnes, 'Pending', :earnings_label, :sort_order, :is_current, false);

-- Query 5.2c: Insert Route Map Points (Waypoints for drawing maps)
INSERT INTO route_map_points (trip_display_id, title, subtitle, details, latitude, longitude, progress, is_claimed, load_offer_id, icon_name, sort_order)
VALUES (:trip_display_id, :title, :subtitle, :details, :latitude, :longitude, 0.00, :is_claimed, :load_offer_id, :icon_name, :sort_order);


-- [Query 5.3] Get Active Trip Overview (Driver App Home)
-- Gets the primary active trip for a driver and its related details.

-- Query 5.3a: Get active trip stats
SELECT id, trip_display_id, route_label, distance, duration, total_earnings, base_freight, fuel_deducted, toll_deducted, net_earnings
FROM trips
WHERE driver_id = :driver_id AND status = 'active'
LIMIT 1;

-- Query 5.3b: Fetch waypoints / stops
SELECT id, customer_name, route_label, goods, drop_location, tonnes, status_label, earnings_label, sort_order, is_current, is_completed
FROM trip_stops
WHERE trip_display_id = :trip_display_id
ORDER BY sort_order ASC;

-- Query 5.3c: Fetch Map points for plotting route lines & icons
SELECT id, title, subtitle, details, latitude, longitude, progress, is_claimed, icon_name, sort_order
FROM route_map_points
WHERE trip_display_id = :trip_display_id
ORDER BY sort_order ASC;


-- [Query 5.4] Update Active Milestone / Stop status
-- Run inside transaction when a stop is completed.

-- Query 5.4a: Mark the completed stop
UPDATE trip_stops
SET is_completed = true, status_label = 'Delivered', is_current = false, updated_at = now()
WHERE id = :stop_id;

-- Query 5.4b: Update the next stop to be current (if any)
UPDATE trip_stops
SET is_current = true, status_label = 'In Progress', updated_at = now()
WHERE trip_display_id = :trip_display_id AND sort_order = :next_sort_order;

-- Query 5.4c: Update the map point progress marker
UPDATE route_map_points
SET progress = 1.00, updated_at = now()
WHERE trip_display_id = :trip_display_id AND sort_order = :completed_sort_order;


-- [Query 5.5] Finalize / Complete Driver Trip
-- Step 1: Update trip status to completed.
UPDATE trips
SET status = 'completed', end_time = :end_time, updated_at = now()
WHERE trip_display_id = :trip_display_id;

-- Step 2: Update driver's global aggregated metrics in driver_details.
UPDATE driver_details
SET 
  total_trips = total_trips + 1,
  wallet_confirmed = wallet_confirmed + :net_earnings, -- Crediting earnings to wallet
  wallet_total = wallet_total + :net_earnings,
  updated_at = now()
WHERE user_id = :driver_id;

-- Step 3: Log credit transactions in wallet_transactions history.
INSERT INTO wallet_transactions (driver_id, trip_display_id, amount, txn_type, status, description)
VALUES (:driver_id, :trip_display_id, :net_earnings, 'credit', 'confirmed', 'Payout for Trip ' || :trip_display_id);

-- Step 4: Record daily summary statistics for analytical charts.
INSERT INTO earnings_daily (driver_id, day_date, amount, trip_count)
VALUES (:driver_id, CURRENT_DATE, :net_earnings, 1)
ON CONFLICT (driver_id, day_date)
DO UPDATE SET 
  amount = earnings_daily.amount + EXCLUDED.amount,
  trip_count = earnings_daily.trip_count + 1;



-- ────────────────────────────────────────────────────────────────────────────
-- 6. TELEMATICS & MAINTENANCE WORKFLOWS
-- ────────────────────────────────────────────────────────────────────────────

-- [Query 6.1] Update Truck Diagnostics Cache (Latest stats from live telematics)
-- SQL:
UPDATE trucks
SET 
  fuel_level_pct = :fuel,
  engine_health_pct = :engine,
  avg_tyre_pressure_psi = :pressure,
  oil_quality_pct = :oil,
  next_service_km = :service,
  tpms_connected = :tpms,
  updated_at = now()
WHERE id = :truck_id;


-- [Query 6.2] Retrieve Full Tyre Pressure Matrix
-- SQL:
SELECT id, position, pressure_psi, status, updated_at
FROM tyre_diagnostics
WHERE truck_id = :truck_id
ORDER BY position ASC;


-- [Query 6.3] Create Maintenance Ticket
-- SQL:
INSERT INTO truck_maintenance_tickets (truck_id, driver_id, category, description, status)
VALUES (:truck_id, :driver_id, :category, :description, 'open')
RETURNING id;


-- [Query 6.4] Retrieve Active Truck Issues
-- SQL:
SELECT id, category, description, status, created_at
FROM truck_maintenance_tickets
WHERE truck_id = :truck_id AND status <> 'resolved'
ORDER BY created_at DESC;



-- ────────────────────────────────────────────────────────────────────────────
-- 7. WALLET, EARNINGS CHARTS, & GAMIFICATION
-- ────────────────────────────────────────────────────────────────────────────

-- [Query 7.1] Fetch Wallet Balances and Core Driver Stats
-- SQL:
SELECT rating, total_trips, completion_rate, wallet_confirmed, wallet_pending, wallet_total
FROM driver_details
WHERE user_id = :driver_id;


-- [Query 7.2] Fetch Wallet Transaction Statements
-- SQL:
SELECT id, order_display_id, trip_display_id, amount, txn_type, status, description, created_at
FROM wallet_transactions
WHERE driver_id = :driver_id
ORDER BY created_at DESC;


-- [Query 7.3] Fetch Aggregated Earnings for Daily/Weekly Chart Rendering
-- SQL:
SELECT day_date, amount, trip_count
FROM earnings_daily
WHERE driver_id = :driver_id 
  AND day_date >= CURRENT_DATE - INTERVAL '30 days' -- Fetch trailing 30 days
ORDER BY day_date ASC;


-- [Query 7.4] Initiate Withdrawal Request
-- Step 1: Check driver details has sufficient confirmed balance.
-- (Validations performed at API layer; client executes debit insertion)

-- Step 2: Insert Pending Transaction in Wallet
INSERT INTO wallet_transactions (driver_id, amount, txn_type, status, description)
VALUES (:driver_id, :amount, 'withdrawal', 'pending', 'Withdrawal to registered bank account')
RETURNING id;

-- Step 3: Move wallet balance from confirmed to pending category.
UPDATE driver_details
SET 
  wallet_confirmed = wallet_confirmed - :amount,
  wallet_pending = wallet_pending + :amount,
  updated_at = now()
WHERE user_id = :driver_id;



-- ────────────────────────────────────────────────────────────────────────────
-- 8. CUSTOMER & DRIVER NOTIFICATIONS, FAQS & SUPPORT
-- ────────────────────────────────────────────────────────────────────────────

-- [Query 8.1] Fetch Unread Notifications Count
-- SQL:
SELECT COUNT(*)::int as unread_count
FROM notifications
WHERE user_id = :user_id AND is_read = false;


-- [Query 8.2] Fetch Inbox Notifications
-- SQL:
SELECT id, title, body, notif_type, is_read, metadata, created_at
FROM notifications
WHERE user_id = :user_id
ORDER BY created_at DESC
LIMIT 50;


-- [Query 8.3] Mark Notifications as Read
-- SQL:
UPDATE notifications
SET is_read = true
WHERE user_id = :user_id AND is_read = false;


-- [Query 8.4] Get FAQs Filtered by Target App
-- SQL:
SELECT question, answer, sort_order
FROM faqs
WHERE app_type IN (:app_type, 'both') AND is_active = true
ORDER BY sort_order ASC;


-- [Query 8.5] Submit Support Ticket
-- SQL:
INSERT INTO support_tickets (user_id, subject, description, category, status)
VALUES (:user_id, :subject, :description, :category, 'open')
RETURNING id, created_at;


-- [Query 8.6] View Support Ticket History
-- SQL:
SELECT id, subject, status, category, created_at, updated_at
FROM support_tickets
WHERE user_id = :user_id
ORDER BY updated_at DESC;
