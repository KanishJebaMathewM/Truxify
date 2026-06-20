-- ============================================================================
-- TRUXIFY — COMPLETE SUPABASE SETUP (ONE-SHOT)
-- ============================================================================
--
-- HOW TO USE:
--   1. Create a new Supabase project at https://supabase.com
--   2. Go to SQL Editor → New Query
--   3. Paste this ENTIRE file and click "Run"
--   4. Copy your project URL + anon key into .env
--   5. You're done! All 27 tables, indexes, RLS policies, RPC functions,
--      and seed data are ready.
--
-- DESIGN PRINCIPLES:
--   1. Critical business entities use foreign-key constraints for integrity.
--      Non-critical analytics / denormalized fields remain application-managed.
--   2. UUIDs for internal PKs; human-readable display IDs in text columns.
--   3. Timestamps are always `timestamptz` (UTC-aware).
--   4. Money is stored as integer (paisa) to avoid float rounding.
--      Display formatting (₹) happens in the app.
--   5. Row Level Security (RLS) is enabled on every table with policies.
--
-- WHAT IS *NOT* IN SUPABASE (by design):
--   • GPS live pings / driver activity events  → MongoDB Atlas
--   • ML training data                         → MongoDB Atlas
--   • User sessions                            → Upstash Redis
--   • API response cache / rate-limit counters  → Upstash Redis
--   • Driver document files / profile photos    → Cloudflare R2
--   • Auth tokens                               → Firebase Auth
--   • Push notification tokens                  → Firebase FCM
--   • Smart-contract state / on-chain reputation → Polygon
--   • Delivery receipts (on-chain)              → Polygon
-- ============================================================================


-- ############################################################################
-- PART 0: UTILITY — Auto-update `updated_at` trigger function
-- ############################################################################

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create or replace function get_profile_id()
returns uuid
language sql stable security definer
as $$
  select id from profiles where firebase_uid = (auth.jwt() ->> 'sub') limit 1;
$$;


-- ############################################################################
-- PART 1: TABLE DEFINITIONS (27 tables)
-- ############################################################################


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PROFILES  (unified for both customer & driver)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id            uuid primary key default gen_random_uuid(),
  firebase_uid  text unique not null,                         -- Firebase Auth UID
  role          text not null check (role in ('customer', 'driver')),
  full_name     text not null,
  phone         text not null,
  email         text,
  company_name  text,                                         -- customer: company; driver: nullable
  avatar_url    text,                                         -- Cloudflare R2 URL
  language      text not null default 'en',
  dark_mode     boolean not null default false,
  is_active     boolean not null default true,
  polygon_wallet_address text,                                  -- Polygon wallet address for escrow deposits
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_profiles_firebase_uid on profiles (firebase_uid);
create index if not exists idx_profiles_phone        on profiles (phone);
create index if not exists idx_profiles_role         on profiles (role);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. DRIVER DETAILS  (driver-specific extended profile)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists driver_details (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,                            -- profiles.id (no FK)
  truck_id          uuid,                                     -- trucks.id  (no FK)
  rating            numeric(3,2) not null default 0.00,       -- e.g. 4.80
  total_trips       int not null default 0,
  completion_rate   numeric(5,2) not null default 100.00,     -- percentage
  is_online         boolean not null default false,
  wallet_confirmed  int not null default 0,                   -- paisa
  wallet_pending    int not null default 0,
  wallet_total      int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists idx_driver_details_user on driver_details (user_id);
create index if not exists idx_driver_details_truck on driver_details (truck_id);
alter table driver_details
  add constraint driver_details_user_id_fkey
  foreign key (user_id) references profiles(id)
  on update cascade on delete cascade;
alter table driver_details
  add constraint driver_details_truck_id_fkey
  foreign key (truck_id) references trucks(id)
  on update cascade on delete set null;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. CUSTOMER STATS  (customer-specific metrics)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists customer_stats (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,                              -- profiles.id
  total_orders    int not null default 0,
  total_saved     int not null default 0,                     -- paisa saved vs broker
  co2_reduced_kg  numeric(10,2) not null default 0.00,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists idx_customer_stats_user on customer_stats (user_id);
alter table customer_stats
  add constraint customer_stats_user_id_fkey
  foreign key (user_id) references profiles(id)
  on update cascade on delete cascade;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. TRUCKS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists trucks (
  id                    uuid primary key default gen_random_uuid(),
  driver_id             uuid not null,                        -- profiles.id
  name                  text not null,                        -- e.g. 'Tata 407'
  number_plate          text not null,                        -- e.g. 'TN 45 AB 1234'
  max_capacity_tons     numeric(6,2) not null default 0,
  cargo_length_ft       numeric(6,2),
  cargo_width_ft        numeric(6,2),
  cargo_height_ft       numeric(6,2),
  -- Compliance dates
  insurance_expiry      date,
  puc_expiry            date,
  permit_expiry         date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_trucks_driver on trucks (driver_id);
alter table trucks
  add constraint trucks_driver_id_fkey
  foreign key (driver_id) references profiles(id)
  on update cascade on delete restrict;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. TYRE DIAGNOSTICS  (per-position tyre data for a truck)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists tyre_diagnostics (
  id          uuid primary key default gen_random_uuid(),
  truck_id    uuid not null,                                  -- trucks.id
  position    text not null,                                  -- 'front_left', 'front_right', etc.
  pressure_psi numeric(5,1) not null,
  status      text not null default 'normal'
              check (status in ('normal', 'low', 'critical')),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_tyre_diag_truck on tyre_diagnostics (truck_id);
alter table tyre_diagnostics
  add constraint tyre_diagnostics_truck_id_fkey
  foreign key (truck_id) references trucks(id)
  on update cascade on delete cascade;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. TRUCK MAINTENANCE TICKETS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists truck_maintenance_tickets (
  id          uuid primary key default gen_random_uuid(),
  truck_id    uuid not null,                                  -- trucks.id
  driver_id   uuid not null,                                  -- profiles.id
  category    text not null
              check (category in ('Engine','Tyres','Brakes','Electricals','Documents','Other')),
  description text not null,
  status      text not null default 'open'
              check (status in ('open', 'in_progress', 'resolved')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_maint_tickets_truck  on truck_maintenance_tickets (truck_id);
create index if not exists idx_maint_tickets_status on truck_maintenance_tickets (status);
create index if not exists idx_maint_tickets_driver on truck_maintenance_tickets (driver_id);
alter table truck_maintenance_tickets
  add constraint truck_maintenance_tickets_truck_id_fkey
  foreign key (truck_id) references trucks(id)
  on update cascade on delete cascade;
alter table truck_maintenance_tickets
  add constraint truck_maintenance_tickets_driver_id_fkey
  foreign key (driver_id) references profiles(id)
  on update cascade on delete restrict;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. SAVED ADDRESSES  (customer)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists saved_addresses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,                                 -- profiles.id
  label        text not null,                                 -- 'Office', 'Home', 'Warehouse'
  address_line text not null,
  city         text,
  state        text,
  pincode      text,
  latitude     double precision,
  longitude    double precision,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists idx_saved_addr_user on saved_addresses (user_id);
alter table saved_addresses
  add constraint saved_addresses_user_id_fkey
  foreign key (user_id) references profiles(id)
  on update cascade on delete cascade;


-- ────────────────────────────────────────────────────────────────────────────
-- 8. PAYMENT METHODS  (customer)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists payment_methods (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,                                -- profiles.id
  method_type   text not null
                check (method_type in ('upi', 'credit_card', 'debit_card', 'net_banking')),
  display_label text not null,                                -- masked card or UPI handle
  provider      text,                                         -- 'Visa', 'Mastercard', 'RuPay', etc.
  is_default    boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_payment_methods_user on payment_methods (user_id);
alter table payment_methods
  add constraint payment_methods_user_id_fkey
  foreign key (user_id) references profiles(id)
  on update cascade on delete cascade;


-- ────────────────────────────────────────────────────────────────────────────
-- 9. DOCUMENTS  (metadata only — actual files live in Cloudflare R2)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists documents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,                             -- profiles.id
  doc_type         text not null
                   check (doc_type in (
                     'aadhar','pan','business_license','bank_account',
                     'rc_book','driving_licence','insurance','puc'
                   )),
  status           text not null default 'pending'
                   check (status in ('pending','verified','expiring_soon','expired','rejected')),
  file_url         text,                                      -- Cloudflare R2 URL
  ipfs_hash        text,                                      -- IPFS content hash
  blockchain_hash  text,                                      -- on-chain verification hash
  last_verified_at timestamptz,
  valid_until      date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_documents_user     on documents (user_id);
alter table documents
  add constraint documents_user_id_fkey
  foreign key (user_id) references profiles(id)
  on update cascade on delete cascade;
create index if not exists idx_documents_type     on documents (doc_type);
create index if not exists idx_documents_status   on documents (status);


-- ────────────────────────────────────────────────────────────────────────────
-- 10. ORDERS  (the core booking/order table — customer side)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists orders (
  id                   uuid primary key default gen_random_uuid(),
  order_display_id     text unique not null,                  -- '#FF20241205'
  customer_id          uuid not null,                         -- profiles.id
  driver_id            uuid,                                  -- profiles.id (null until assigned)
  truck_id             uuid,                                  -- trucks.id   (null until assigned)

  status               text not null default 'pending'
                       check (status in (
                         'pending','truck_assigned','en_route_pickup','arrived_pickup',
                         'picked_up','in_transit','arriving','delivered','cancelled',
                         'payment_released'
                       )),

  -- Route
  pickup_address       text not null,
  pickup_lat           double precision not null,
  pickup_lng           double precision not null,
  drop_address         text not null,
  drop_lat             double precision not null,
  drop_lng             double precision not null,

  -- Schedule
  pickup_date          date not null,
  pickup_time          time,

  -- Goods
  goods_type           text not null,
  weight_tonnes        numeric(8,2) not null,
  length_ft            numeric(6,2),
  width_ft             numeric(6,2),
  height_ft            numeric(6,2),
  is_stackable         boolean not null default false,
  is_fragile           boolean not null default false,
  special_requirements text[],                                -- postgres array

  -- Pricing (paisa)
  base_freight         int not null default 0,
  toll_estimate        int not null default 0,
  platform_fee         int not null default 0,
  total_amount         int not null default 0,
  cancellation_fee     int not null default 0,
  cancellation_reason  text,

  -- Payment
  payment_method_id    uuid,                                  -- payment_methods.id
  upi_id               text,

  -- Blockchain
  blockchain_tx_hash   text,

  -- Driver info snapshot (denormalized for fast reads)
  driver_name          text,
  driver_rating        numeric(3,2),
  truck_number         text,

  -- ETA
  eta                  text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Delivery Verification
  delivery_otp         text,                                    -- OTP for delivery verification
  otp_verified         boolean not null default false,          -- Whether OTP has been verified
  otp_generated_at     timestamptz                              -- When OTP was generated
);

create index if not exists idx_orders_customer     on orders (customer_id);
create index if not exists idx_orders_driver       on orders (driver_id);
create index if not exists idx_orders_status       on orders (status);
create index if not exists idx_orders_pickup_date  on orders (pickup_date);
create index if not exists idx_orders_display_id   on orders (order_display_id);
alter table orders
  add constraint orders_customer_id_fkey
  foreign key (customer_id) references profiles(id)
  on update cascade on delete restrict;
alter table orders
  add constraint orders_driver_id_fkey
  foreign key (driver_id) references profiles(id)
  on update cascade on delete set null;


-- ────────────────────────────────────────────────────────────────────────────
-- 11. ORDER TIMELINE  (milestone events for an order)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists order_timeline (
  id                uuid primary key default gen_random_uuid(),
  order_display_id  text not null,                            -- orders.order_display_id
  milestone         text not null,                            -- 'Order Placed', 'Truck Assigned', etc.
  milestone_time    timestamptz,
  completed         boolean not null default false,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists idx_order_timeline_order on order_timeline (order_display_id);
alter table order_timeline
  add constraint order_timeline_order_display_id_fkey
  foreign key (order_display_id) references orders(order_display_id)
  on update cascade on delete cascade;


-- ────────────────────────────────────────────────────────────────────────────
-- 12. LOAD OFFERS  (freight loads available for drivers)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists load_offers (
  id                uuid primary key default gen_random_uuid(),
  order_display_id  text,                                     -- orders.order_display_id (nullable)
  customer_id       uuid not null,                            -- profiles.id
  customer_name     text not null,
  company_name      text,

  -- Route
  route_label       text not null,                            -- 'Surat → Jaipur'
  route_subtitle    text,
  pickup_address    text not null,
  pickup_lat        double precision,
  pickup_lng        double precision,
  drop_address      text not null,
  drop_lat          double precision,
  drop_lng          double precision,
  route_distance    text,                                     -- '620 km'
  route_duration    text,                                     -- '~10 hrs'

  -- Goods
  goods_type        text not null,
  weight            text not null,                            -- '3 tonnes'
  dimensions        text,                                     -- '12 × 6 × 6 ft'
  is_stackable      boolean not null default false,
  is_fragile        boolean not null default false,
  special_handling  text,

  -- Pricing
  freight_value     int not null default 0,                   -- paisa
  fuel_cost         int not null default 0,
  toll_cost         int not null default 0,
  net_profit        int not null default 0,

  -- Capacity
  capacity_used     numeric(3,2) not null default 0.00,       -- 0.00–1.00
  truck_fill_label  text,                                     -- '60% full after load'
  space_available   text,

  -- Badges
  badge_label       text,                                     -- 'Best Profit'
  badge_emoji       text,                                     -- '🏆'
  is_best_profit    boolean not null default false,

  -- En-route opportunity fields
  is_en_route       boolean not null default false,
  extra_distance_km int,
  extra_earnings    int,                                      -- paisa
  route_note        text,

  -- Matching
  distance_from_driver text,                                  -- '12 km away'

  status            text not null default 'available'
                    check (status in ('available','claimed','expired','cancelled')),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_load_offers_status     on load_offers (status);
create index if not exists idx_load_offers_customer   on load_offers (customer_id);
create index if not exists idx_load_offers_en_route   on load_offers (is_en_route);
alter table load_offers
  add constraint load_offers_customer_id_fkey
  foreign key (customer_id) references profiles(id)
  on update cascade on delete restrict;


-- ────────────────────────────────────────────────────────────────────────────
-- 13. LOAD BIDS  (driver bids on load offers)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists load_bids (
  id          uuid primary key default gen_random_uuid(),
  load_id     uuid not null,                                  -- load_offers.id
  driver_id   uuid not null,                                  -- profiles.id
  bid_amount  int not null,                                   -- paisa
  status      text not null default 'pending'
              check (status in ('pending','accepted','rejected','withdrawn')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_load_bids_load   on load_bids (load_id);
create index if not exists idx_load_bids_driver on load_bids (driver_id);
create index if not exists idx_load_bids_status on load_bids (status);
alter table load_bids
  add constraint load_bids_load_id_fkey
  foreign key (load_id) references load_offers(id)
  on update cascade on delete cascade;
alter table load_bids
  add constraint load_bids_driver_id_fkey
  foreign key (driver_id) references profiles(id)
  on update cascade on delete restrict;


-- ────────────────────────────────────────────────────────────────────────────
-- 14. TRIPS  (driver trips — one trip can carry multiple customers)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists trips (
  id                uuid primary key default gen_random_uuid(),
  trip_display_id   text unique not null,                     -- '#TX20241205'
  driver_id         uuid not null,                            -- profiles.id
  route_label       text not null,                            -- 'Surat → Jaipur'

  status            text not null default 'active'
                    check (status in ('active','completed','cancelled')),

  trip_date         date not null,
  distance          text,                                     -- '620 km'
  duration          text,                                     -- '10h 20m'
  end_time          text,

  -- Earnings (paisa)
  total_earnings    int not null default 0,
  base_freight      int not null default 0,
  fuel_deducted     int not null default 0,
  toll_deducted     int not null default 0,
  platform_fee      int not null default 0,
  net_earnings      int not null default 0,

  -- Blockchain
  blockchain_hash   text,
  verified_on_chain boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_trips_driver     on trips (driver_id);
create index if not exists idx_trips_status     on trips (status);
create index if not exists idx_trips_date       on trips (trip_date);
create index if not exists idx_trips_display_id on trips (trip_display_id);
create unique index if not exists idx_trips_one_active_per_driver on trips (driver_id) where (status = 'active');


-- ────────────────────────────────────────────────────────────────────────────
-- 15. TRIP ITEMS  (per-customer deliveries within a trip)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists trip_items (
  id              uuid primary key default gen_random_uuid(),
  trip_display_id text not null,                              -- trips.trip_display_id
  customer_name   text not null,
  goods           text not null,
  destination     text not null,
  earnings        int not null default 0,                     -- paisa
  is_delivered    boolean not null default false,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_trip_items_trip on trip_items (trip_display_id);
alter table trip_items
  add constraint trip_items_trip_display_id_fkey
  foreign key (trip_display_id) references trips(trip_display_id)
  on update cascade on delete cascade;


-- ────────────────────────────────────────────────────────────────────────────
-- 16. TRIP STOPS  (waypoints / stops on an active trip)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists trip_stops (
  id              uuid primary key default gen_random_uuid(),
  trip_display_id text not null,                              -- trips.trip_display_id
  customer_name   text not null,
  route_label     text not null,
  goods           text not null,
  drop_location   text not null,
  tonnes          text,
  status_label    text not null,                              -- 'Delivered', 'In Progress', 'Pending'
  earnings_label  text,
  sort_order      int not null default 0,
  is_current      boolean not null default false,
  is_completed    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_trip_stops_trip on trip_stops (trip_display_id);
alter table trip_stops
  add constraint trip_stops_trip_display_id_fkey
  foreign key (trip_display_id) references trips(trip_display_id)
  on update cascade on delete cascade;


-- ────────────────────────────────────────────────────────────────────────────
-- 17. ROUTE MAP POINTS  (map waypoints for a driver's active route)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists route_map_points (
  id              uuid primary key default gen_random_uuid(),
  trip_display_id text not null,                              -- trips.trip_display_id
  title           text not null,
  subtitle        text,
  details         text,
  latitude        double precision not null,
  longitude       double precision not null,
  progress        numeric(3,2) not null default 0.00,         -- 0.00–1.00 along route
  is_claimed      boolean not null default false,
  load_offer_id   uuid,                                       -- load_offers.id (nullable)
  icon_name       text,                                       -- Flutter icon name for client
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_route_map_trip on route_map_points (trip_display_id);
alter table route_map_points
  add constraint route_map_points_trip_display_id_fkey
  foreign key (trip_display_id) references trips(trip_display_id)
  on update cascade on delete cascade;


-- ────────────────────────────────────────────────────────────────────────────
-- 18. RATINGS & REVIEWS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists ratings (
  id               uuid primary key default gen_random_uuid(),
  order_display_id text not null,                             -- orders.order_display_id
  customer_id      uuid not null,                             -- profiles.id (reviewer)
  driver_id        uuid not null,                             -- profiles.id (reviewed)
  stars            smallint not null check (stars between 1 and 5),
  comment          text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_ratings_driver   on ratings (driver_id);
create index if not exists idx_ratings_customer on ratings (customer_id);
create index if not exists idx_ratings_order    on ratings (order_display_id);
alter table ratings
  add constraint ratings_customer_id_fkey
  foreign key (customer_id) references profiles(id)
  on update cascade on delete restrict;
alter table ratings
  add constraint ratings_driver_id_fkey
  foreign key (driver_id) references profiles(id)
  on update cascade on delete restrict;
alter table ratings
  add constraint ratings_order_display_id_fkey
  foreign key (order_display_id) references orders(order_display_id)
  on update cascade on delete restrict;


-- ────────────────────────────────────────────────────────────────────────────
-- 19A. PROCESSED BATCHES (offline sync idempotency)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists processed_batches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  user_id uuid not null,
  event_count int not null default 0,
  processed_at timestamptz not null default now(),
  constraint processed_batches_user_idempotency_unique unique (user_id, idempotency_key)
);

create index if not exists idx_processed_batches_user_id
on processed_batches (user_id);

create index if not exists idx_processed_batches_processed_at
on processed_batches (processed_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 19. WALLET TRANSACTIONS  (driver earnings / withdrawals)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists wallet_transactions (
  id               uuid primary key default gen_random_uuid(),
  driver_id        uuid not null,                             -- profiles.id
  order_display_id text,                                      -- orders.order_display_id
  trip_display_id  text,                                      -- trips.trip_display_id
  amount           int not null,                              -- paisa (always positive)
  txn_type         text not null
                   check (txn_type in ('credit','debit','withdrawal','refund')),
  status           text not null default 'confirmed'
                   check (status in ('confirmed','pending','failed')),
  tx_hash          text,                                      -- blockchain payout transaction hash
  description      text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_wallet_txn_driver on wallet_transactions (driver_id);
create index if not exists idx_wallet_txn_status on wallet_transactions (status);
create index if not exists idx_wallet_txn_type   on wallet_transactions (txn_type);
create index if not exists idx_wallet_txn_order  on wallet_transactions (order_display_id);
create index if not exists idx_wallet_txn_trip   on wallet_transactions (trip_display_id);
alter table wallet_transactions
  add constraint wallet_transactions_driver_id_fkey
  foreign key (driver_id) references profiles(id)
  on update cascade on delete restrict;
alter table wallet_transactions
  add constraint wallet_transactions_order_display_id_fkey
  foreign key (order_display_id) references orders(order_display_id)
  on update cascade on delete restrict;
alter table wallet_transactions
  add constraint wallet_transactions_trip_display_id_fkey
  foreign key (trip_display_id) references trips(trip_display_id)
  on update cascade on delete restrict;


-- ────────────────────────────────────────────────────────────────────────────
-- 20. DEMAND ROUTES  (high-demand route intelligence)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists demand_routes (
  id                  uuid primary key default gen_random_uuid(),
  route_label         text not null,                          -- 'Surat → Mumbai'
  demand_level        text not null default 'Medium'
                      check (demand_level in ('High','Medium','Low')),
  estimated_earnings  int not null default 0,                 -- paisa
  note                text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);


-- ────────────────────────────────────────────────────────────────────────────
-- 21. NOTIFICATIONS  (in-app notifications — NOT push tokens)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,                                  -- profiles.id
  title       text not null,
  body        text not null,
  notif_type  text not null default 'system'
              check (notif_type in ('order_update','payment','load_offer','trip_update','document','system')),
  is_read     boolean not null default false,
  metadata    jsonb,                                          -- flexible payload
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user   on notifications (user_id);
create index if not exists idx_notifications_unread on notifications (user_id, is_read) where is_read = false;
alter table notifications
  add constraint notifications_user_id_fkey
  foreign key (user_id) references profiles(id)
  on update cascade on delete restrict;


-- ────────────────────────────────────────────────────────────────────────────
-- 22. FAQS  (help & support content)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists faqs (
  id          uuid primary key default gen_random_uuid(),
  app_type    text not null default 'both'
              check (app_type in ('customer','driver','both')),
  question    text not null,
  answer      text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists idx_faqs_app_type on faqs (app_type);


-- ────────────────────────────────────────────────────────────────────────────
-- 23. SUPPORT TICKETS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,                                  -- profiles.id
  subject     text not null,
  description text not null,
  category    text not null default 'general'
              check (category in ('order','payment','technical','account','general')),
  status      text not null default 'open'
              check (status in ('open','in_progress','resolved','closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_support_tickets_user   on support_tickets (user_id);
create index if not exists idx_support_tickets_status on support_tickets (status);
alter table support_tickets
  add constraint support_tickets_user_id_fkey
  foreign key (user_id) references profiles(id)
  on update cascade on delete restrict;


-- ────────────────────────────────────────────────────────────────────────────
-- 24. EARNINGS DAILY SUMMARY  (pre-aggregated for the earnings chart)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists earnings_daily (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references profiles(id) on delete cascade,
  day_date     date not null,
  amount       int not null default 0,                          -- paisa
  trip_count   int not null default 0,
  hours_driven numeric(4,2) not null default 0.00,
  created_at   timestamptz not null default now(),
  constraint earnings_daily_driver_day_unique unique (driver_id, day_date)
);

create unique index if not exists idx_earnings_daily_driver_day on earnings_daily (driver_id, day_date);


-- ############################################################################
-- PART 2: ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ############################################################################

alter table profiles                enable row level security;
alter table driver_details          enable row level security;
alter table customer_stats          enable row level security;
alter table trucks                  enable row level security;
alter table tyre_diagnostics        enable row level security;
alter table truck_maintenance_tickets enable row level security;
alter table saved_addresses         enable row level security;
alter table payment_methods         enable row level security;
alter table documents               enable row level security;
alter table orders                  enable row level security;
alter table order_timeline          enable row level security;
alter table load_offers             enable row level security;
alter table load_bids               enable row level security;
alter table trips                   enable row level security;
alter table trip_items              enable row level security;
alter table trip_stops              enable row level security;
alter table route_map_points        enable row level security;
alter table ratings                 enable row level security;
alter table wallet_transactions     enable row level security;
alter table processed_batches       enable row level security;
alter table demand_routes           enable row level security;
alter table notifications           enable row level security;
alter table faqs                    enable row level security;
alter table support_tickets         enable row level security;
alter table earnings_daily          enable row level security;


-- ############################################################################
-- PART 3: ROW LEVEL SECURITY POLICIES
-- ############################################################################
--
-- Since the backend API uses the service_role key (which bypasses RLS),
-- these policies are for:
--   a) Future direct-client access from Flutter (supabase_flutter SDK)
--   b) Supabase Dashboard Data Editor access
--   c) Defense in depth
--
-- Pattern: service_role gets full access; authenticated users see their own data.
-- Public/read-only tables (faqs, milestones, demand_routes) allow anon SELECT.
-- ────────────────────────────────────────────────────────────────────────────

-- Helper: service-role full-access policy (applied to all tables)
-- We create one policy per table for service_role to have full CRUD.

-- 1. PROFILES
create policy "Service role full access on profiles"
  on profiles for all
  to service_role
  using (true) with check (true);

create policy "Users select own profile"
  on profiles for select
  to authenticated
  using (firebase_uid = (auth.jwt() ->> 'sub'));

create policy "Users insert own profile"
  on profiles for insert
  to authenticated
  with check (firebase_uid = (auth.jwt() ->> 'sub'));

create policy "Users update own profile"
  on profiles for update
  to authenticated
  using (firebase_uid = (auth.jwt() ->> 'sub'))
  with check (firebase_uid = (auth.jwt() ->> 'sub'));


-- 2. DRIVER DETAILS
create policy "Service role full access on driver_details"
  on driver_details for all
  to service_role
  using (true) with check (true);

create policy "Drivers access own driver_details"
  on driver_details for all
  to authenticated
  using (user_id = get_profile_id())
  with check (user_id = get_profile_id());


-- 3. CUSTOMER STATS
create policy "Service role full access on customer_stats"
  on customer_stats for all
  to service_role
  using (true) with check (true);

create policy "Customers access own stats"
  on customer_stats for all
  to authenticated
  using (user_id = get_profile_id())
  with check (user_id = get_profile_id());


-- 4. TRUCKS
create policy "Service role full access on trucks"
  on trucks for all
  to service_role
  using (true) with check (true);

create policy "Drivers access own trucks"
  on trucks for all
  to authenticated
  using (driver_id = get_profile_id())
  with check (driver_id = get_profile_id());


-- 5. TYRE DIAGNOSTICS
create policy "Service role full access on tyre_diagnostics"
  on tyre_diagnostics for all
  to service_role
  using (true) with check (true);

create policy "Drivers view own tyre diagnostics"
  on tyre_diagnostics for select
  to authenticated
  using (
    truck_id in (
      select id from trucks where driver_id = get_profile_id()
    )
  );


-- 6. TRUCK MAINTENANCE TICKETS
create policy "Service role full access on truck_maintenance_tickets"
  on truck_maintenance_tickets for all
  to service_role
  using (true) with check (true);

create policy "Drivers access own maintenance tickets"
  on truck_maintenance_tickets for all
  to authenticated
  using (driver_id = get_profile_id())
  with check (driver_id = get_profile_id());


-- 7. SAVED ADDRESSES
create policy "Service role full access on saved_addresses"
  on saved_addresses for all
  to service_role
  using (true) with check (true);

create policy "Users access own saved addresses"
  on saved_addresses for all
  to authenticated
  using (user_id = get_profile_id())
  with check (user_id = get_profile_id());


-- 8. PAYMENT METHODS
create policy "Service role full access on payment_methods"
  on payment_methods for all
  to service_role
  using (true) with check (true);

create policy "Users access own payment methods"
  on payment_methods for all
  to authenticated
  using (user_id = get_profile_id())
  with check (user_id = get_profile_id());


-- 9. DOCUMENTS
create policy "Service role full access on documents"
  on documents for all
  to service_role
  using (true) with check (true);

create policy "Users access own documents"
  on documents for all
  to authenticated
  using (user_id = get_profile_id())
  with check (user_id = get_profile_id());


-- 10. ORDERS
create policy "Service role full access on orders"
  on orders for all
  to service_role
  using (true) with check (true);

create policy "Customers access own orders"
  on orders for all
  to authenticated
  using (customer_id = get_profile_id())
  with check (customer_id = get_profile_id());

create policy "Drivers view assigned orders"
  on orders for select
  to authenticated
  using (driver_id = get_profile_id());


-- 11. ORDER TIMELINE
create policy "Service role full access on order_timeline"
  on order_timeline for all
  to service_role
  using (true) with check (true);

create policy "Users view timeline for their orders"
  on order_timeline for select
  to authenticated
  using (
    order_display_id in (
      select order_display_id from orders
      where customer_id = get_profile_id()
         or driver_id   = get_profile_id()
    )
  );


-- 12. LOAD OFFERS
create policy "Service role full access on load_offers"
  on load_offers for all
  to service_role
  using (true) with check (true);

create policy "Authenticated users view available load offers"
  on load_offers for select
  to authenticated
  using (status = 'available' or customer_id = get_profile_id());

create policy "Customers insert own load offers"
  on load_offers for insert
  to authenticated
  with check (customer_id = get_profile_id());

create policy "Customers update own load offers"
  on load_offers for update
  to authenticated
  using (customer_id = get_profile_id())
  with check (customer_id = get_profile_id());


-- 13. LOAD BIDS
create policy "Service role full access on load_bids"
  on load_bids for all
  to service_role
  using (true) with check (true);

create policy "Drivers access own bids"
  on load_bids for all
  to authenticated
  using (driver_id = get_profile_id())
  with check (driver_id = get_profile_id());

create policy "Customers view bids on own load offers"
  on load_bids for select
  to authenticated
  using (
    load_id in (
      select id from load_offers where customer_id = get_profile_id()
    )
  );


-- 14. TRIPS
create policy "Service role full access on trips"
  on trips for all
  to service_role
  using (true) with check (true);

create policy "Drivers access own trips"
  on trips for all
  to authenticated
  using (driver_id = get_profile_id())
  with check (driver_id = get_profile_id());


-- 15. TRIP ITEMS
create policy "Service role full access on trip_items"
  on trip_items for all
  to service_role
  using (true) with check (true);

create policy "Drivers view own trip items"
  on trip_items for select
  to authenticated
  using (
    trip_display_id in (
      select trip_display_id from trips where driver_id = get_profile_id()
    )
  );


-- 16. TRIP STOPS
create policy "Service role full access on trip_stops"
  on trip_stops for all
  to service_role
  using (true) with check (true);

create policy "Drivers view own trip stops"
  on trip_stops for select
  to authenticated
  using (
    trip_display_id in (
      select trip_display_id from trips where driver_id = get_profile_id()
    )
  );

create policy "Drivers update own trip stops"
  on trip_stops for update
  to authenticated
  using (
    trip_display_id in (
      select trip_display_id from trips where driver_id = get_profile_id()
    )
  )
  with check (
    trip_display_id in (
      select trip_display_id from trips where driver_id = get_profile_id()
    )
  );


-- 17. ROUTE MAP POINTS
create policy "Service role full access on route_map_points"
  on route_map_points for all
  to service_role
  using (true) with check (true);

create policy "Drivers view own route map points"
  on route_map_points for select
  to authenticated
  using (
    trip_display_id in (
      select trip_display_id from trips where driver_id = get_profile_id()
    )
  );


-- 18. RATINGS
create policy "Service role full access on ratings"
  on ratings for all
  to service_role
  using (true) with check (true);

create policy "Customers manage own ratings"
  on ratings for all
  to authenticated
  using (customer_id = get_profile_id())
  with check (customer_id = get_profile_id());

create policy "Drivers view ratings about themselves"
  on ratings for select
  to authenticated
  using (driver_id = get_profile_id());


-- 19. WALLET TRANSACTIONS
create policy "Service role full access on wallet_transactions"
  on wallet_transactions for all
  to service_role
  using (true) with check (true);

create policy "Drivers view own wallet transactions"
  on wallet_transactions for select
  to authenticated
  using (driver_id = get_profile_id());


-- 19A. PROCESSED BATCHES
create policy "Service role full access on processed_batches"
  on processed_batches for all
  to service_role
  using (true) with check (true);

create policy "Users view own processed batches"
  on processed_batches for select
  to authenticated
  using (user_id = get_profile_id());


-- 20. DEMAND ROUTES
create policy "Service role full access on demand_routes"
  on demand_routes for all
  to service_role
  using (true) with check (true);

create policy "Authenticated users view active demand routes"
  on demand_routes for select
  to authenticated
  using (is_active = true);

-- 21. NOTIFICATIONS
create policy "Service role full access on notifications"
  on notifications for all
  to service_role
  using (true) with check (true);

create policy "Users access own notifications"
  on notifications for all
  to authenticated
  using (user_id = get_profile_id())
  with check (user_id = get_profile_id());

-- 22. FAQS
create policy "Service role full access on faqs"
  on faqs for all
  to service_role
  using (true) with check (true);

create policy "Anyone can view active FAQs"
  on faqs for select
  to anon, authenticated
  using (is_active = true);


-- 23. SUPPORT TICKETS
create policy "Service role full access on support_tickets"
  on support_tickets for all
  to service_role
  using (true) with check (true);

create policy "Users access own support tickets"
  on support_tickets for all
  to authenticated
  using (user_id = get_profile_id())
  with check (user_id = get_profile_id());


-- 24. EARNINGS DAILY
create policy "Service role full access on earnings_daily"
  on earnings_daily for all
  to service_role
  using (true) with check (true);

create policy "Drivers view own earnings daily"
  on earnings_daily for select
  to authenticated
  using (driver_id = get_profile_id());



-- ############################################################################
-- PART 4: AUTO-UPDATE `updated_at` TRIGGERS
-- ############################################################################
-- Applied to every table that has an `updated_at` column.

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

create trigger trg_driver_details_updated_at
  before update on driver_details
  for each row execute function set_updated_at();

create trigger trg_customer_stats_updated_at
  before update on customer_stats
  for each row execute function set_updated_at();

create trigger trg_trucks_updated_at
  before update on trucks
  for each row execute function set_updated_at();

create trigger trg_tyre_diagnostics_updated_at
  before update on tyre_diagnostics
  for each row execute function set_updated_at();

create trigger trg_maint_tickets_updated_at
  before update on truck_maintenance_tickets
  for each row execute function set_updated_at();

create trigger trg_documents_updated_at
  before update on documents
  for each row execute function set_updated_at();

create trigger trg_orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

create trigger trg_load_offers_updated_at
  before update on load_offers
  for each row execute function set_updated_at();

create trigger trg_load_bids_updated_at
  before update on load_bids
  for each row execute function set_updated_at();

create trigger trg_trips_updated_at
  before update on trips
  for each row execute function set_updated_at();

create trigger trg_trip_stops_updated_at
  before update on trip_stops
  for each row execute function set_updated_at();

create trigger trg_route_map_points_updated_at
  before update on route_map_points
  for each row execute function set_updated_at();

create trigger trg_demand_routes_updated_at
  before update on demand_routes
  for each row execute function set_updated_at();

create trigger trg_support_tickets_updated_at
  before update on support_tickets
  for each row execute function set_updated_at();


-- ############################################################################
-- PART 5: RPC FUNCTIONS (Server-side atomic transactions)
-- ############################################################################


-- ────────────────────────────────────────────────────────────────────────────
-- RPC 1: accept_bid_tx — Accept a driver's bid on a load offer atomically
-- Called from: POST /api/orders/:id/bids/:bidId/accept
-- ────────────────────────────────────────────────────────────────────────────
create or replace function accept_bid_tx(
  p_bid_id        uuid,
  p_order_id      uuid,
  p_load_id       uuid,
  p_driver_id     uuid,
  p_truck_id      uuid,
  p_driver_name   text,
  p_driver_rating numeric,
  p_truck_number  text,
  p_bid_amount    int,
  p_order_display_id text
) returns void
language plpgsql
security definer          -- runs with table-owner privileges (bypasses RLS)
as $$
declare
  v_load_status text;
  v_order_status text;
begin
    -- Lock load offer row; concurrent calls block here until this transaction completes
  select status into v_load_status
    from load_offers
    where id = p_load_id
    for update;

  if v_load_status is null or v_load_status <> 'available' then
    raise exception 'Load offer is no longer available';
  end if;

  -- Lock order row before modifying driver assignment
  select status into v_order_status
    from orders
    where id = p_order_id
    for update;

  if v_order_status is null or v_order_status <> 'pending' then
    raise exception 'Order is no longer pending';
  end if;
  -- Step 1: Accept the chosen bid
  update load_bids
    set status = 'accepted', updated_at = now()
    where id = p_bid_id;

  -- Step 2: Reject all other bids for this load
  update load_bids
    set status = 'rejected', updated_at = now()
    where load_id = p_load_id
      and id != p_bid_id;

  -- Step 3: Mark load offer as claimed
  update load_offers
    set status = 'claimed', updated_at = now()
    where id = p_load_id;

  -- Step 4: Assign driver + truck to order, update pricing
  update orders
    set driver_id     = p_driver_id,
        truck_id      = p_truck_id,
        status        = 'truck_assigned',
        driver_name   = p_driver_name,
        driver_rating = p_driver_rating,
        truck_number  = p_truck_number,
        total_amount  = p_bid_amount,
        updated_at    = now()
    where id = p_order_id;

  -- Step 5: Mark "Truck Assigned" milestone as completed
  update order_timeline
    set completed      = true,
        milestone_time = now()
    where order_display_id = p_order_display_id
      and milestone = 'Truck Assigned';
end;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- RPC 2: withdraw_funds_tx — Withdraw from driver wallet atomically
-- Called from: POST /api/drivers/wallet/withdraw
-- ────────────────────────────────────────────────────────────────────────────
create or replace function withdraw_funds_tx(
  p_driver_id   uuid,
  p_amount      int
) returns void
language plpgsql
security definer
as $$
declare
  v_confirmed int;
  v_pending   int;
begin
  -- Lock the row to prevent concurrent withdrawals
  select wallet_confirmed, wallet_pending
    into v_confirmed, v_pending
    from driver_details
    where user_id = p_driver_id
    for update;

  if v_confirmed < p_amount then
    raise exception 'Insufficient balance: available %, requested %',
      v_confirmed, p_amount;
  end if;

  -- Move funds from confirmed → pending
  update driver_details
    set wallet_confirmed = v_confirmed - p_amount,
        wallet_pending   = v_pending   + p_amount,
        updated_at       = now()
    where user_id = p_driver_id;

  -- Log the withdrawal transaction
  insert into wallet_transactions
    (driver_id, amount, txn_type, status, description)
  values
    (p_driver_id, p_amount, 'withdrawal', 'pending',
     'Withdrawal to registered bank account');
end;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- RPC 3: complete_trip_tx — Finalize a driver trip atomically
-- Matches the multi-step flow in supabase_queries.sql Query 5.5
-- ────────────────────────────────────────────────────────────────────────────
create or replace function complete_trip_tx(
  p_trip_display_id text,
  p_driver_id       uuid,
  p_net_earnings    int,
  p_hours_driven    numeric(4,2),
  p_end_time        text
) returns void
language plpgsql
security definer
as $$
begin
  -- Step 1: Mark trip as completed
  update trips
    set status   = 'completed',
        end_time = p_end_time,
        updated_at = now()
    where trip_display_id = p_trip_display_id;

  -- Step 2: Increment driver stats and credit wallet
  update driver_details
    set total_trips      = total_trips + 1,
        wallet_confirmed = wallet_confirmed + p_net_earnings,
        wallet_total     = wallet_total + p_net_earnings,
        updated_at       = now()
    where user_id = p_driver_id;

  -- Step 3: Log credit transaction
  insert into wallet_transactions
    (driver_id, trip_display_id, amount, txn_type, status, description)
  values
    (p_driver_id, p_trip_display_id, p_net_earnings, 'credit', 'confirmed',
     'Payout for Trip ' || p_trip_display_id);

  -- Step 4: Upsert daily earnings summary
  insert into earnings_daily (driver_id, day_date, amount, trip_count, hours_driven)
  values (p_driver_id, current_date, p_net_earnings, 1, p_hours_driven)
  on conflict (driver_id, day_date)
  do update set
    amount       = earnings_daily.amount + excluded.amount,
    trip_count   = earnings_daily.trip_count + 1,
    hours_driven = earnings_daily.hours_driven + excluded.hours_driven;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- RPC 4: complete_trip_tx (overload) — Complete an order and release payment using order ID
-- ────────────────────────────────────────────────────────────────────────────
create or replace function complete_trip_tx(p_order_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_order record;
  v_trip_display_id text;
  v_active_trip_count int;
begin
  select * into v_order from orders where id = p_order_id;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.driver_id is null then
    raise exception 'No driver assigned to this order';
  end if;

  -- Idempotency guard: check if the order status is already payment_released
  if v_order.status = 'payment_released' then
    return;
  end if;

  -- Safe lookup for the driver's active trip
  select count(*) into v_active_trip_count
  from trips
  where driver_id = v_order.driver_id and status = 'active';

  if v_active_trip_count > 1 then
    raise exception 'Multiple active trips found for driver %', v_order.driver_id;
  end if;

  if v_active_trip_count = 1 then
    select trip_display_id into v_trip_display_id
    from trips
    where driver_id = v_order.driver_id and status = 'active';

    -- Update trip record
    update trips
    set status = 'completed',
        end_time = to_char(now(), 'HH24:MI'),
        updated_at = now()
    where trip_display_id = v_trip_display_id;

    -- Update trip items to delivered
    update trip_items
    set is_delivered = true
    where trip_display_id = v_trip_display_id;

    -- Update trip stops to completed/delivered
    update trip_stops
    set is_completed = true,
        is_current = false,
        status_label = 'Delivered',
        updated_at = now()
    where trip_display_id = v_trip_display_id;
  end if;

  -- Update order status to payment_released
  update orders
  set otp_verified = true,
      status = 'payment_released',
      updated_at = now()
  where id = p_order_id;

  -- Update order timeline milestone 'Delivered'
  update order_timeline
  set completed = true,
      milestone_time = now()
  where order_display_id = v_order.order_display_id and milestone = 'Delivered';

  -- Update driver's wallet
  update driver_details
  set
    total_trips = total_trips + 1,
    wallet_confirmed = wallet_confirmed + v_order.total_amount,
    wallet_total = wallet_total + v_order.total_amount,
    updated_at = now()
  where user_id = v_order.driver_id;

  -- Log wallet transaction
  insert into wallet_transactions (
    driver_id, order_display_id, amount, txn_type, status, description
  ) values (
    v_order.driver_id,
    v_order.order_display_id,
    v_order.total_amount,
    'credit',
    'confirmed',
    'Payout for Order ' || v_order.order_display_id
  );

  -- Update daily earnings summary
  insert into earnings_daily (driver_id, day_date, amount, trip_count)
  values (v_order.driver_id, current_date, v_order.total_amount, 1)
  on conflict (driver_id, day_date)
  do update set
    amount = earnings_daily.amount + excluded.amount,
    trip_count = earnings_daily.trip_count + 1;
end;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- RPC 4: submit_rating_tx — Submit rating and recalculate driver average
-- ────────────────────────────────────────────────────────────────────────────
create or replace function submit_rating_tx(
  p_order_display_id text,
  p_customer_id      uuid,
  p_driver_id        uuid,
  p_stars            smallint,
  p_comment          text default null
) returns void
language plpgsql
security definer
as $$
declare
  v_new_avg numeric(3,2);
begin
  -- Step 1: Insert the rating
  insert into ratings (order_display_id, customer_id, driver_id, stars, comment)
  values (p_order_display_id, p_customer_id, p_driver_id, p_stars, p_comment);

  -- Step 2: Recalculate driver average rating
  select round(avg(stars)::numeric, 2)
    into v_new_avg
    from ratings
    where driver_id = p_driver_id;

  -- Step 3: Update driver_details with new average
  update driver_details
    set rating     = v_new_avg,
        updated_at = now()
    where user_id = p_driver_id;
end;
$$;


-- ############################################################################
-- PART 6: SEED DATA (Test data for local development)
-- ############################################################################
-- These UUIDs are deterministic so contributors can reference them in tests.
-- Passwords / auth tokens are managed by Firebase Auth, not Supabase.

-- Seed Profiles (1 customer + 1 driver)
insert into profiles (id, firebase_uid, role, full_name, phone, email, company_name, language, polygon_wallet_address)
values
  ('a1111111-1111-1111-1111-111111111111', 'firebase_customer_001', 'customer',
   'Rajesh Kumar', '+919876543210', 'rajesh@truxify.dev', 'Kumar Logistics', 'en',
   '0x1234567890abcdef1234567890abcdef12345678'),
  ('b2222222-2222-2222-2222-222222222222', 'firebase_driver_001', 'driver',
   'Suresh Yadav', '+919988776655', 'suresh@truxify.dev', null, 'hi',
   null)
on conflict (firebase_uid) do nothing;

-- Seed Customer Stats
insert into customer_stats (user_id, total_orders, total_saved, co2_reduced_kg)
values ('a1111111-1111-1111-1111-111111111111', 5, 1250000, 42.50)
on conflict (user_id) do nothing;

-- Seed Truck
insert into trucks (id, driver_id, name, number_plate, max_capacity_tons,
  cargo_length_ft, cargo_width_ft, cargo_height_ft, insurance_expiry, puc_expiry, permit_expiry)
values
  ('c3333333-3333-3333-3333-333333333333',
   'b2222222-2222-2222-2222-222222222222',
   'Tata 407', 'GJ 05 AB 1234', 7.50,
   14.00, 6.00, 6.50,
   '2027-03-15', '2026-12-31', '2027-06-30')
on conflict do nothing;

-- Seed Driver Details
insert into driver_details (user_id, truck_id, rating, total_trips, completion_rate,
  is_online, wallet_confirmed, wallet_pending, wallet_total, polygon_wallet_address)
values
  ('b2222222-2222-2222-2222-222222222222',
   'c3333333-3333-3333-3333-333333333333',
   4.72, 148, 96.50, true, 4500000, 750000, 5250000,
   '0xAbcdef1234567890Abcdef1234567890Abcdef12')
on conflict (user_id) do nothing;

-- Seed Tyre Diagnostics
insert into tyre_diagnostics (truck_id, position, pressure_psi, status)
values
  ('c3333333-3333-3333-3333-333333333333', 'front_left',      34.5, 'normal'),
  ('c3333333-3333-3333-3333-333333333333', 'front_right',     35.0, 'normal'),
  ('c3333333-3333-3333-3333-333333333333', 'rear_outer_left', 28.0, 'low'),
  ('c3333333-3333-3333-3333-333333333333', 'rear_outer_right', 34.0, 'normal'),
  ('c3333333-3333-3333-3333-333333333333', 'rear_inner_left', 33.5, 'normal'),
  ('c3333333-3333-3333-3333-333333333333', 'rear_inner_right', 34.2, 'normal')
on conflict do nothing;

-- Seed Saved Addresses
insert into saved_addresses (user_id, label, address_line, city, state, pincode, latitude, longitude, is_default)
values
  ('a1111111-1111-1111-1111-111111111111', 'Office', '45 Ring Road, GIDC', 'Surat', 'Gujarat', '395010', 21.1702, 72.8311, true),
  ('a1111111-1111-1111-1111-111111111111', 'Warehouse', 'Plot 12, Mahindra Park', 'Ahmedabad', 'Gujarat', '380015', 23.0225, 72.5714, false)
on conflict do nothing;

-- Seed Payment Methods
insert into payment_methods (user_id, method_type, display_label, provider, is_default)
values
  ('a1111111-1111-1111-1111-111111111111', 'upi', 'rajesh@okaxis', null, true),
  ('a1111111-1111-1111-1111-111111111111', 'credit_card', '•••• 4242', 'Visa', false)
on conflict do nothing;

-- Seed Documents
insert into documents (user_id, doc_type, status, valid_until)
values
  ('b2222222-2222-2222-2222-222222222222', 'driving_licence', 'verified', '2028-05-15'),
  ('b2222222-2222-2222-2222-222222222222', 'rc_book', 'verified', '2027-03-15'),
  ('b2222222-2222-2222-2222-222222222222', 'insurance', 'expiring_soon', '2026-07-01'),
  ('b2222222-2222-2222-2222-222222222222', 'puc', 'verified', '2026-12-31'),
  ('b2222222-2222-2222-2222-222222222222', 'aadhar', 'verified', null),
  ('a1111111-1111-1111-1111-111111111111', 'pan', 'verified', null),
  ('a1111111-1111-1111-1111-111111111111', 'business_license', 'verified', '2028-01-01')
on conflict do nothing;

-- Seed a sample Order
insert into orders (id, order_display_id, customer_id, status,
  pickup_address, pickup_lat, pickup_lng,
  drop_address, drop_lat, drop_lng,
  pickup_date, pickup_time,
  goods_type, weight_tonnes,
  base_freight, toll_estimate, platform_fee, total_amount)
values
  ('d4444444-4444-4444-4444-444444444444', '#FF202605311001',
   'a1111111-1111-1111-1111-111111111111', 'pending',
   '45 Ring Road, GIDC, Surat', 21.1702, 72.8311,
   'Warehouse 7, Jaipur Industrial Area', 26.9124, 75.7873,
   current_date, '08:00',
   'Electronics', 3.50,
   2800000, 350000, 140000, 3290000)
on conflict do nothing;

-- Seed Order Timeline
insert into order_timeline (order_display_id, milestone, milestone_time, completed, sort_order)
values
  ('#FF202605311001', 'Order Placed', now(), true, 10),
  ('#FF202605311001', 'Truck Assigned', null, false, 20),
  ('#FF202605311001', 'En Route to Pickup', null, false, 30),
  ('#FF202605311001', 'Arrived at Pickup', null, false, 35),
  ('#FF202605311001', 'Goods Loaded', null, false, 40),
  ('#FF202605311001', 'In Transit', null, false, 50),
  ('#FF202605311001', 'Delivered', null, false, 60)
on conflict do nothing;

-- Seed Load Offer (auto-created from order)
insert into load_offers (id, order_display_id, customer_id, customer_name,
  route_label, route_subtitle,
  pickup_address, pickup_lat, pickup_lng,
  drop_address, drop_lat, drop_lng,
  route_distance, route_duration,
  goods_type, weight, freight_value, fuel_cost, toll_cost, net_profit,
  status)
values
  ('e5555555-5555-5555-5555-555555555555', '#FF202605311001',
   'a1111111-1111-1111-1111-111111111111', 'Rajesh Kumar',
   'Surat → Jaipur', '3.5 tonnes • Electronics',
   '45 Ring Road, GIDC, Surat', 21.1702, 72.8311,
   'Warehouse 7, Jaipur Industrial Area', 26.9124, 75.7873,
   '620 km', '~10 hrs',
   'Electronics', '3.5 tonnes',
   2800000, 1260000, 350000, 1190000,
   'available')
on conflict do nothing;

-- Seed Demand Routes
insert into demand_routes (route_label, demand_level, estimated_earnings, note, is_active)
values
  ('Surat → Mumbai',    'High',   1800000, 'Peak textile season',          true),
  ('Delhi → Jaipur',    'High',   2200000, 'FMCG corridor demand',         true),
  ('Mumbai → Pune',     'Medium', 950000,  'Steady industrial flow',       true),
  ('Chennai → Bangalore','Medium',1400000, 'IT hardware movement',         true),
  ('Kolkata → Patna',   'Low',    600000,  'Low but consistent demand',    true)
on conflict do nothing;


-- Seed FAQs
insert into faqs (app_type, question, answer, sort_order, is_active)
values
  ('customer', 'How do I place a booking?',
   'Go to the Home tab, enter your pickup and drop locations, fill in cargo details, and tap "Get Quotes". You will receive bids from verified drivers within minutes.',
   10, true),
  ('customer', 'How is pricing calculated?',
   'Pricing is based on distance, cargo weight, goods type, and current demand. We eliminate broker margins so you save 15-25% compared to traditional logistics.',
   20, true),
  ('customer', 'Can I cancel my order?',
   'Yes, you can cancel before the truck is picked up. A small cancellation fee may apply if the driver has already started traveling to the pickup location.',
   30, true),
  ('driver', 'How do I receive load offers?',
   'Once you go online, available loads matching your route and truck capacity will appear on your home screen. You can bid on any load you want to carry.',
   10, true),
  ('driver', 'When do I get paid?',
   'Earnings are credited to your wallet instantly upon delivery confirmation. You can withdraw to your bank account anytime.',
   20, true),
  ('driver', 'What documents do I need?',
   'You need a valid Driving Licence, RC Book, Insurance, PUC certificate, and Aadhaar card. All documents are verified digitally.',
   30, true),
  ('both', 'How do I contact support?',
   'Go to Settings → Help & Support → Submit a Ticket. You can also reach us at support@truxify.com.',
   40, true),
  ('both', 'Is my data secure?',
   'Yes. We use end-to-end encryption, blockchain-verified documents, and follow industry-standard security practices. Your personal data is never shared with third parties.',
   50, true)
on conflict do nothing;

-- Seed Notifications (welcome messages)
insert into notifications (user_id, title, body, notif_type, is_read)
values
  ('a1111111-1111-1111-1111-111111111111', 'Welcome to Truxify! 🚛',
   'Your account is set up. Place your first booking to experience broker-free freight.',
   'system', false),
  ('b2222222-2222-2222-2222-222222222222', 'Welcome aboard, Suresh! 🎉',
   'Your documents are verified. Go online to start receiving load offers.',
   'system', false)
on conflict do nothing;

-- Seed Earnings Daily (last 7 days for the seed driver)
insert into earnings_daily (driver_id, day_date, amount, trip_count, hours_driven)
values
  ('b2222222-2222-2222-2222-222222222222', current_date - 6, 1850000, 2, 5.20),
  ('b2222222-2222-2222-2222-222222222222', current_date - 5, 0, 0, 0.00),
  ('b2222222-2222-2222-2222-222222222222', current_date - 4, 2400000, 3, 8.50),
  ('b2222222-2222-2222-2222-222222222222', current_date - 3, 1200000, 1, 3.50),
  ('b2222222-2222-2222-2222-222222222222', current_date - 2, 3100000, 3, 9.00),
  ('b2222222-2222-2222-2222-222222222222', current_date - 1, 1600000, 2, 4.80),
  ('b2222222-2222-2222-2222-222222222222', current_date,     900000, 1, 2.50)
on conflict (driver_id, day_date) do nothing;

-- Seed Wallet Transactions (recent history)
insert into wallet_transactions (driver_id, trip_display_id, amount, txn_type, status, description)
values
  ('b2222222-2222-2222-2222-222222222222', '#TX20260525001', 1850000, 'credit', 'confirmed', 'Payout for Trip #TX20260525001'),
  ('b2222222-2222-2222-2222-222222222222', '#TX20260527001', 2400000, 'credit', 'confirmed', 'Payout for Trip #TX20260527001'),
  ('b2222222-2222-2222-2222-222222222222', null,             1500000, 'withdrawal', 'confirmed', 'Withdrawal to registered bank account'),
  ('b2222222-2222-2222-2222-222222222222', '#TX20260529001', 3100000, 'credit', 'confirmed', 'Payout for Trip #TX20260529001'),
  ('b2222222-2222-2222-2222-222222222222', '#TX20260530001', 1600000, 'credit', 'confirmed', 'Payout for Trip #TX20260530001')
on conflict do nothing;

-- Sync wallet_transactions with orders on release_tx_hash update
CREATE OR REPLACE FUNCTION sync_wallet_tx_hash()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.release_tx_hash IS NOT NULL AND (OLD.release_tx_hash IS NULL OR OLD.release_tx_hash <> NEW.release_tx_hash) THEN
    UPDATE wallet_transactions
    SET tx_hash = NEW.release_tx_hash,
        description = 'Escrow payout for ' || NEW.order_display_id
    WHERE order_display_id = NEW.order_display_id
      AND txn_type = 'credit';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_wallet_tx_hash ON orders;
CREATE TRIGGER trigger_sync_wallet_tx_hash
AFTER UPDATE OF release_tx_hash ON orders
FOR EACH ROW
EXECUTE FUNCTION sync_wallet_tx_hash();


-- ============================================================================
-- ✅ SETUP COMPLETE
-- ============================================================================
-- Your Supabase database now has:
--   • 25 tables with indexes
--   • Row Level Security enabled + permissive policies
--   • Auto-updating `updated_at` triggers
--   • 4 RPC functions: accept_bid_tx, withdraw_funds_tx, complete_trip_tx, submit_rating_tx
--   • Seed data: 1 customer, 1 driver, 1 truck, 1 order, FAQs, etc.
--
-- NEXT STEPS:
--   1. Copy your Supabase URL + anon key into .env
--   2. Run `cd backend/api && npm install && npm run dev`
--   3. Test with: GET /api/drivers/stats (with x-test-mode + x-user-id headers)
-- ============================================================================
