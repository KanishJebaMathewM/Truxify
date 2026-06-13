# 📊 Database Schema & SQL Transaction Flows

Truxify implements a decoupled database design across **Supabase (PostgreSQL)**, **MongoDB**, and **Redis**. Relational integrity, row authorizations, and atomic operations reside in Supabase, while event history is kept in MongoDB and in-memory caches in Redis.

---

## 🗺️ Entity Relationship Diagram (ERD)

Truxify tracks 27 distinct entities. Logical relationships (application-level joins) are utilized to link data together:

```mermaid
erDiagram
    profiles {
        uuid id PK
        text firebase_uid UK
        text role
        text full_name
        text phone
        text email
        text company_name
        text avatar_url
        text language
        boolean dark_mode
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    driver_details {
        uuid id PK
        uuid user_id UK
        uuid truck_id
        numeric rating
        int total_trips
        numeric completion_rate
        boolean is_online
        int wallet_confirmed
        int wallet_pending
        int wallet_total
    }

    customer_stats {
        uuid id PK
        uuid user_id UK
        int total_orders
        int total_saved
        numeric co2_reduced_kg
    }

    trucks {
        uuid id PK
        uuid driver_id
        text name
        text number_plate
        numeric max_capacity_tons
        int fuel_level_pct
        int engine_health_pct
        boolean tpms_connected
        date insurance_expiry
        date puc_expiry
        date permit_expiry
    }

    orders {
        uuid id PK
        text order_display_id UK
        uuid customer_id
        uuid driver_id
        uuid truck_id
        text status
        text pickup_address
        float pickup_lat
        float pickup_lng
        text drop_address
        float drop_lat
        float drop_lng
        date pickup_date
        text goods_type
        numeric weight_tonnes
        int total_amount
        text cancellation_reason
        text driver_name
        text eta
    }

    trips {
        uuid id PK
        text trip_display_id UK
        uuid driver_id
        text route_label
        text status
        date trip_date
        int total_earnings
        int net_earnings
        text blockchain_hash
        boolean verified_on_chain
    }

    documents {
        uuid id PK
        uuid user_id
        text doc_type
        text status
        text file_url
        text blockchain_hash
        date valid_until
    }

    profiles ||--|| driver_details : "user_id"
    profiles ||--|| customer_stats : "user_id"
    profiles ||--o{ orders : "customer_id"
    driver_details ||--o| trucks : "truck_id"
    trucks ||--o{ orders : "truck_id"
    orders ||--|| trips : "order_id"
    profiles ||--o{ documents : "user_id"
```

---

## 🧠 Referential Integrity Model

> [!IMPORTANT]
> Truxify now enforces physical foreign keys for critical financial and operational entities. This keeps the core user, order, load, bid, rating, wallet, notification, and support data consistent at the database layer.
>
> **Why?**
> 1. **Data safety**: Invalid references are rejected before they reach application logic.
> 2. **Operational consistency**: Cascades are used only where child rows are ownership records that should disappear with the parent.
> 3. **Auditability**: Financial and transactional records remain protected with `RESTRICT` where deletion would break history.

### Enforced foreign keys

* `driver_details.user_id → profiles.id` with `ON DELETE CASCADE`
* `driver_details.truck_id → trucks.id` with `ON DELETE SET NULL`
* `customer_stats.user_id → profiles.id` with `ON DELETE CASCADE`
* `trucks.driver_id → profiles.id` with `ON DELETE RESTRICT`
* `orders.customer_id → profiles.id` with `ON DELETE RESTRICT`
* `orders.driver_id → profiles.id` with `ON DELETE SET NULL`
* `load_offers.customer_id → profiles.id` with `ON DELETE RESTRICT`
* `load_bids.load_id → load_offers.id` with `ON DELETE CASCADE`
* `load_bids.driver_id → profiles.id` with `ON DELETE RESTRICT`
* `ratings.customer_id → profiles.id` with `ON DELETE RESTRICT`
* `ratings.driver_id → profiles.id` with `ON DELETE RESTRICT`
* `ratings.order_display_id → orders.order_display_id` with `ON DELETE RESTRICT`
* `wallet_transactions.driver_id → profiles.id` with `ON DELETE RESTRICT`
* `wallet_transactions.order_display_id → orders.order_display_id` with `ON DELETE RESTRICT`
* `wallet_transactions.trip_display_id → trips.trip_display_id` with `ON DELETE RESTRICT`
* `notifications.user_id → profiles.id` with `ON DELETE RESTRICT`
* `support_tickets.user_id → profiles.id` with `ON DELETE RESTRICT`
* `order_timeline.order_display_id → orders.order_display_id` with `ON DELETE CASCADE`
* `trip_items.trip_display_id → trips.trip_display_id` with `ON DELETE CASCADE`
* `trip_stops.trip_display_id → trips.trip_display_id` with `ON DELETE CASCADE`
* `route_map_points.trip_display_id → trips.trip_display_id` with `ON DELETE CASCADE`
* `documents.user_id → profiles.id` with `ON DELETE CASCADE`
* `tyre_diagnostics.truck_id → trucks.id` with `ON DELETE CASCADE`
* `truck_maintenance_tickets.truck_id → trucks.id` with `ON DELETE CASCADE`
* `truck_maintenance_tickets.driver_id → profiles.id` with `ON DELETE RESTRICT`
* `saved_addresses.user_id → profiles.id` with `ON DELETE CASCADE`
* `payment_methods.user_id → profiles.id` with `ON DELETE CASCADE`

---

## 🗃️ Core Table Definitions

### 1. Identity & Profiles
* **`profiles`**: The central user index. Stores names, emails, phones, and settings. Linked to Firebase Auth via `firebase_uid`.
* **`driver_details`**: Extended stats for drivers, including ratings, trip counts, online toggles, and wallet ledger values.
* **`customer_stats`**: Aggregates customer booking frequencies, dynamic savings, and calculated CO₂ reductions.

### 2. Fleet & Diagnostics
* **`trucks`**: Stores truck capacities, registration plates, fuel/engine telemetry, and document expiry flags.
* **`tyre_diagnostics`**: Real-time TPMS pressure values mapped per tyre position (front-left, rear-right, etc.).
* **`truck_maintenance_tickets`**: Tracks repair requests and scheduling histories for trucks.

### 3. Orders & Marketplace
* **`orders`**: Stores pickup/drop coordinates, weight, cargo type, pricing details, status, and assigned driver.
* **`order_timeline`**: Milestones for active orders (e.g., "Assigned", "Picked Up", "In Transit", "Reached", "Delivered").
* **`load_offers`**: Marketplace listings visible to nearby drivers.
* **`load_bids`**: Bids placed by drivers on active load offers.

### 4. Trip Logs & Maps
* **`trips`**: Active driver routing records tracking earnings and verification states.
* **`trip_stops`**: Sequential drop off points mapped to multi-delivery routes.
* **`route_map_points`**: GPS breadcrumbs indicating historical routes.

---

## ⚡ SQL Transaction Flows (RPC Functions)

To prevent race conditions, double-allocations, or partial record failures during critical state changes, Truxify runs atomic SQL routines inside PostgreSQL.

### 1. Bid Acceptance (`accept_bid_tx`)
When a customer accepts a driver's bid:
```sql
-- Logical sequence:
-- 1. Verify bid is 'pending' and order is 'pending'
-- 2. Lock order and driver records using SELECT FOR UPDATE
-- 3. Update order status to 'assigned', assign driver_id and truck_id
-- 4. Update load_offers status to 'assigned'
-- 5. Mark accepted bid as 'accepted' and all other bids for that load as 'rejected'
-- 6. Insert first milestone into order_timeline
```

### 2. Trip Completion (`complete_trip_tx`)
When a driver enters the correct customer OTP and confirms delivery:
```sql
-- Logical sequence:
-- 1. Lock orders, trips, and driver_details records
-- 2. Update order status to 'delivered' and trip status to 'completed'
-- 3. Transition order_timeline milestones to 'completed'
-- 4. Credit earnings to driver's balance in driver_details:
--    - Add trip net profit to wallet_confirmed
--    - Deduct from wallet_pending (if previously escrowed)
-- 5. Create a transaction audit log in wallet_history
```

### 3. Wallet Withdrawal (`withdraw_funds_tx`)
When a driver requests a withdrawal from their in-app wallet to UPI:
```sql
-- Logical sequence:
-- 1. SELECT wallet_confirmed FROM driver_details FOR UPDATE
-- 2. Check if balance >= request_amount
-- 3. Deduct request_amount from wallet_confirmed and wallet_total
-- 4. Log transaction in wallet_history with status = 'processing'
--    (n8n or UPI broker handles execution; failures revert the balance)
```

### 4. Reputation Update (`submit_rating_tx`)
When a customer rates a driver after a trip:
```sql
-- Logical sequence:
-- 1. Insert review into ratings table
-- 2. Compute new average rating for user:
--    avg_rating = (SUM(stars) / COUNT(ratings))
-- 3. Update driver_details.rating
-- 4. Trigger on-chain event logger queue
```
