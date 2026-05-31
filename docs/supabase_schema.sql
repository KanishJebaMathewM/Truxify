-- ============================================================================
-- TRUXIFY — SUPABASE DATABASE SCHEMA
-- ============================================================================
--
-- DESIGN PRINCIPLES:
--   1. ALL TABLES ARE INDEPENDENT — zero foreign-key constraints (no wires).
--      Related IDs are stored as plain uuid / text columns.
--      Joins happen at the application or API layer.
--   2. UUIDs are used for internal PKs; human-readable display IDs
--      (like #FF20241205) live in separate text columns.
--   3. Timestamps are always `timestamptz` (UTC-aware).
--   4. Money is stored as integer (paisa) to avoid float rounding.
--      Display formatting (₹) happens in the app.
--   5. Row Level Security (RLS) is enabled on every table.
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
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_profiles_firebase_uid on profiles (firebase_uid);
create index idx_profiles_phone        on profiles (phone);
create index idx_profiles_role         on profiles (role);

alter table profiles enable row level security;


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

create unique index idx_driver_details_user on driver_details (user_id);

alter table driver_details enable row level security;


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

create unique index idx_customer_stats_user on customer_stats (user_id);

alter table customer_stats enable row level security;


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
  -- Live telemetry snapshots (latest values cached here; history in MongoDB)
  fuel_level_pct        int,
  engine_health_pct     int,
  avg_tyre_pressure_psi int,
  oil_quality_pct       int,
  next_service_km       int,
  tpms_connected        boolean not null default false,
  -- Compliance dates
  insurance_expiry      date,
  puc_expiry            date,
  permit_expiry         date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_trucks_driver on trucks (driver_id);

alter table trucks enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. TYRE DIAGNOSTICS  (per-position tyre data for a truck)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists tyre_diagnostics (
  id          uuid primary key default gen_random_uuid(),
  truck_id    uuid not null,                                  -- trucks.id
  position    text not null,                                  -- 'front_left', 'front_right', 'rear_outer_left', etc.
  pressure_psi numeric(5,1) not null,
  status      text not null default 'normal'
              check (status in ('normal', 'low', 'critical')),
  updated_at  timestamptz not null default now()
);

create index idx_tyre_diag_truck on tyre_diagnostics (truck_id);

alter table tyre_diagnostics enable row level security;


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

create index idx_maint_tickets_truck  on truck_maintenance_tickets (truck_id);
create index idx_maint_tickets_status on truck_maintenance_tickets (status);

alter table truck_maintenance_tickets enable row level security;


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

create index idx_saved_addr_user on saved_addresses (user_id);

alter table saved_addresses enable row level security;


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

create index idx_payment_methods_user on payment_methods (user_id);

alter table payment_methods enable row level security;


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

create index idx_documents_user     on documents (user_id);
create index idx_documents_type     on documents (doc_type);
create index idx_documents_status   on documents (status);

alter table documents enable row level security;


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
                         'pending','truck_assigned','picked_up','in_transit',
                         'arriving','delivered','cancelled','payment_released'
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
  updated_at           timestamptz not null default now()
);

create index idx_orders_customer     on orders (customer_id);
create index idx_orders_driver       on orders (driver_id);
create index idx_orders_status       on orders (status);
create index idx_orders_pickup_date  on orders (pickup_date);
create index idx_orders_display_id   on orders (order_display_id);

alter table orders enable row level security;


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

create index idx_order_timeline_order on order_timeline (order_display_id);

alter table order_timeline enable row level security;


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

create index idx_load_offers_status     on load_offers (status);
create index idx_load_offers_customer   on load_offers (customer_id);
create index idx_load_offers_en_route   on load_offers (is_en_route);

alter table load_offers enable row level security;


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

create index idx_load_bids_load   on load_bids (load_id);
create index idx_load_bids_driver on load_bids (driver_id);
create index idx_load_bids_status on load_bids (status);

alter table load_bids enable row level security;


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

create index idx_trips_driver     on trips (driver_id);
create index idx_trips_status     on trips (status);
create index idx_trips_date       on trips (trip_date);
create index idx_trips_display_id on trips (trip_display_id);

alter table trips enable row level security;


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

create index idx_trip_items_trip on trip_items (trip_display_id);

alter table trip_items enable row level security;


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

create index idx_trip_stops_trip on trip_stops (trip_display_id);

alter table trip_stops enable row level security;


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

create index idx_route_map_trip on route_map_points (trip_display_id);

alter table route_map_points enable row level security;


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

create index idx_ratings_driver   on ratings (driver_id);
create index idx_ratings_customer on ratings (customer_id);
create index idx_ratings_order    on ratings (order_display_id);

alter table ratings enable row level security;


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
  description      text,
  created_at       timestamptz not null default now()
);

create index idx_wallet_txn_driver on wallet_transactions (driver_id);
create index idx_wallet_txn_status on wallet_transactions (status);
create index idx_wallet_txn_type   on wallet_transactions (txn_type);

alter table wallet_transactions enable row level security;


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

alter table demand_routes enable row level security;


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

create index idx_notifications_user   on notifications (user_id);
create index idx_notifications_unread on notifications (user_id, is_read) where is_read = false;

alter table notifications enable row level security;


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

create index idx_faqs_app_type on faqs (app_type);

alter table faqs enable row level security;


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

create index idx_support_tickets_user   on support_tickets (user_id);
create index idx_support_tickets_status on support_tickets (status);

alter table support_tickets enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- 24. EARNINGS DAILY SUMMARY  (pre-aggregated for the earnings chart)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists earnings_daily (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null,                                  -- profiles.id
  day_date    date not null,
  amount      int not null default 0,                         -- paisa
  trip_count  int not null default 0,
  created_at  timestamptz not null default now()
);

create unique index idx_earnings_daily_driver_day on earnings_daily (driver_id, day_date);

alter table earnings_daily enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- 25. MILESTONES  (gamification achievements for drivers)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists milestones (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,                                  -- '100 Trips'
  subtitle    text not null,                                  -- 'Century club member'
  icon_name   text,                                           -- Flutter icon reference
  threshold   int not null,                                   -- numeric threshold value
  metric      text not null
              check (metric in ('trips','earnings','rating','completion_rate')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table milestones enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- 26. DRIVER MILESTONES  (which milestones a driver has achieved)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists driver_milestones (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null,                                -- profiles.id
  milestone_id  uuid not null,                                -- milestones.id
  achieved      boolean not null default false,
  progress      numeric(5,2),                                 -- 0.00–100.00 (percentage)
  achieved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create unique index idx_driver_milestones_unique on driver_milestones (driver_id, milestone_id);

alter table driver_milestones enable row level security;
