-- ============================================================================
-- Truxify migration: add referential integrity for critical business entities
-- ============================================================================
-- This migration is idempotent. It only adds the foreign keys if they do not
-- already exist, so it can be run safely on existing databases.

DO $$
BEGIN
  -- ==========================================================================
  -- Pre-flight validation checks for orphaned records to prevent mid-migration failure
  -- ==========================================================================
  
  -- 1. driver_details -> profiles
  IF EXISTS (SELECT 1 FROM driver_details d LEFT JOIN profiles p ON d.user_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in driver_details.user_id referencing profiles.id';
  END IF;

  -- 2. customer_stats -> profiles
  IF EXISTS (SELECT 1 FROM customer_stats c LEFT JOIN profiles p ON c.user_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in customer_stats.user_id referencing profiles.id';
  END IF;

  -- 3. trucks -> profiles
  IF EXISTS (SELECT 1 FROM trucks t LEFT JOIN profiles p ON t.driver_id = p.id WHERE t.driver_id IS NOT NULL AND p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in trucks.driver_id referencing profiles.id';
  END IF;

  -- 4. orders -> profiles (customer_id)
  IF EXISTS (SELECT 1 FROM orders o LEFT JOIN profiles p ON o.customer_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in orders.customer_id referencing profiles.id';
  END IF;

  -- 5. orders -> profiles (driver_id)
  IF EXISTS (SELECT 1 FROM orders o LEFT JOIN profiles p ON o.driver_id = p.id WHERE o.driver_id IS NOT NULL AND p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in orders.driver_id referencing profiles.id';
  END IF;

  -- 6. load_offers -> profiles (customer_id)
  IF EXISTS (SELECT 1 FROM load_offers l LEFT JOIN profiles p ON l.customer_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in load_offers.customer_id referencing profiles.id';
  END IF;

  -- 7. load_bids -> load_offers (load_id)
  IF EXISTS (SELECT 1 FROM load_bids b LEFT JOIN load_offers l ON b.load_id = l.id WHERE b.load_id IS NOT NULL AND l.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in load_bids.load_id referencing load_offers.id';
  END IF;

  -- 8. load_bids -> profiles (driver_id)
  IF EXISTS (SELECT 1 FROM load_bids b LEFT JOIN profiles p ON b.driver_id = p.id WHERE b.driver_id IS NOT NULL AND p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in load_bids.driver_id referencing profiles.id';
  END IF;

  -- 9. ratings -> profiles (customer_id)
  IF EXISTS (SELECT 1 FROM ratings r LEFT JOIN profiles p ON r.customer_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in ratings.customer_id referencing profiles.id';
  END IF;

  -- 10. ratings -> profiles (driver_id)
  IF EXISTS (SELECT 1 FROM ratings r LEFT JOIN profiles p ON r.driver_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in ratings.driver_id referencing profiles.id';
  END IF;

  -- 11. ratings -> orders (order_display_id)
  IF EXISTS (SELECT 1 FROM ratings r LEFT JOIN orders o ON r.order_display_id = o.order_display_id WHERE r.order_display_id IS NOT NULL AND o.order_display_id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in ratings.order_display_id referencing orders.order_display_id';
  END IF;

  -- 12. wallet_transactions -> profiles (driver_id)
  IF EXISTS (SELECT 1 FROM wallet_transactions w LEFT JOIN profiles p ON w.driver_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in wallet_transactions.driver_id referencing profiles.id';
  END IF;

  -- 13. wallet_transactions -> orders (order_display_id)
  IF EXISTS (SELECT 1 FROM wallet_transactions w LEFT JOIN orders o ON w.order_display_id = o.order_display_id WHERE w.order_display_id IS NOT NULL AND o.order_display_id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in wallet_transactions.order_display_id referencing orders.order_display_id';
  END IF;

  -- 14. wallet_transactions -> trips (trip_display_id)
  IF EXISTS (SELECT 1 FROM wallet_transactions w LEFT JOIN trips t ON w.trip_display_id = t.trip_display_id WHERE w.trip_display_id IS NOT NULL AND t.trip_display_id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in wallet_transactions.trip_display_id referencing trips.trip_display_id';
  END IF;

  -- 15. notifications -> profiles (user_id)
  IF EXISTS (SELECT 1 FROM notifications n LEFT JOIN profiles p ON n.user_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in notifications.user_id referencing profiles.id';
  END IF;

  -- 16. support_tickets -> profiles (user_id)
  IF EXISTS (SELECT 1 FROM support_tickets s LEFT JOIN profiles p ON s.user_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in support_tickets.user_id referencing profiles.id';
  END IF;

  -- 17. order_timeline -> orders (order_display_id)
  IF EXISTS (SELECT 1 FROM order_timeline t LEFT JOIN orders o ON t.order_display_id = o.order_display_id WHERE o.order_display_id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in order_timeline.order_display_id referencing orders.order_display_id';
  END IF;

  -- 18. trip_items -> trips (trip_display_id)
  IF EXISTS (SELECT 1 FROM trip_items i LEFT JOIN trips t ON i.trip_display_id = t.trip_display_id WHERE t.trip_display_id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in trip_items.trip_display_id referencing trips.trip_display_id';
  END IF;

  -- 19. trip_stops -> trips (trip_display_id)
  IF EXISTS (SELECT 1 FROM trip_stops s LEFT JOIN trips t ON s.trip_display_id = t.trip_display_id WHERE t.trip_display_id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in trip_stops.trip_display_id referencing trips.trip_display_id';
  END IF;

  -- 20. route_map_points -> trips (trip_display_id)
  IF EXISTS (SELECT 1 FROM route_map_points m LEFT JOIN trips t ON m.trip_display_id = t.trip_display_id WHERE t.trip_display_id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in route_map_points.trip_display_id referencing trips.trip_display_id';
  END IF;

  -- 21. documents -> profiles (user_id)
  IF EXISTS (SELECT 1 FROM documents d LEFT JOIN profiles p ON d.user_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in documents.user_id referencing profiles.id';
  END IF;

  -- 22. tyre_diagnostics -> trucks (truck_id)
  IF EXISTS (SELECT 1 FROM tyre_diagnostics d LEFT JOIN trucks t ON d.truck_id = t.id WHERE t.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in tyre_diagnostics.truck_id referencing trucks.id';
  END IF;

  -- 23. truck_maintenance_tickets -> trucks (truck_id)
  IF EXISTS (SELECT 1 FROM truck_maintenance_tickets k LEFT JOIN trucks t ON k.truck_id = t.id WHERE t.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in truck_maintenance_tickets.truck_id referencing trucks.id';
  END IF;

  -- 24. truck_maintenance_tickets -> profiles (driver_id)
  IF EXISTS (SELECT 1 FROM truck_maintenance_tickets k LEFT JOIN profiles p ON k.driver_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in truck_maintenance_tickets.driver_id referencing profiles.id';
  END IF;

  -- 25. saved_addresses -> profiles (user_id)
  IF EXISTS (SELECT 1 FROM saved_addresses s LEFT JOIN profiles p ON s.user_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in saved_addresses.user_id referencing profiles.id';
  END IF;

  -- 26. payment_methods -> profiles (user_id)
  IF EXISTS (SELECT 1 FROM payment_methods m LEFT JOIN profiles p ON m.user_id = p.id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in payment_methods.user_id referencing profiles.id';
  END IF;

  -- 27. driver_details -> trucks (truck_id)
  IF EXISTS (SELECT 1 FROM driver_details d LEFT JOIN trucks t ON d.truck_id = t.id WHERE d.truck_id IS NOT NULL AND t.id IS NULL) THEN
    RAISE EXCEPTION 'Pre-flight validation failed: orphaned records found in driver_details.truck_id referencing trucks.id';
  END IF;

  -- ==========================================================================
  -- Apply constraints
  -- ==========================================================================

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'driver_details_user_id_fkey'
  ) THEN
    ALTER TABLE driver_details
      ADD CONSTRAINT driver_details_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_stats_user_id_fkey'
  ) THEN
    ALTER TABLE customer_stats
      ADD CONSTRAINT customer_stats_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trucks_driver_id_fkey'
  ) THEN
    ALTER TABLE trucks
      ADD CONSTRAINT trucks_driver_id_fkey
      FOREIGN KEY (driver_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_customer_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_driver_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_driver_id_fkey
      FOREIGN KEY (driver_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'load_offers_customer_id_fkey'
  ) THEN
    ALTER TABLE load_offers
      ADD CONSTRAINT load_offers_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'load_bids_load_id_fkey'
  ) THEN
    ALTER TABLE load_bids
      ADD CONSTRAINT load_bids_load_id_fkey
      FOREIGN KEY (load_id) REFERENCES load_offers(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'load_bids_driver_id_fkey'
  ) THEN
    ALTER TABLE load_bids
      ADD CONSTRAINT load_bids_driver_id_fkey
      FOREIGN KEY (driver_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ratings_customer_id_fkey'
  ) THEN
    ALTER TABLE ratings
      ADD CONSTRAINT ratings_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ratings_driver_id_fkey'
  ) THEN
    ALTER TABLE ratings
      ADD CONSTRAINT ratings_driver_id_fkey
      FOREIGN KEY (driver_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ratings_order_display_id_fkey'
  ) THEN
    ALTER TABLE ratings
      ADD CONSTRAINT ratings_order_display_id_fkey
      FOREIGN KEY (order_display_id) REFERENCES orders(order_display_id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_driver_id_fkey'
  ) THEN
    ALTER TABLE wallet_transactions
      ADD CONSTRAINT wallet_transactions_driver_id_fkey
      FOREIGN KEY (driver_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_order_display_id_fkey'
  ) THEN
    ALTER TABLE wallet_transactions
      ADD CONSTRAINT wallet_transactions_order_display_id_fkey
      FOREIGN KEY (order_display_id) REFERENCES orders(order_display_id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_trip_display_id_fkey'
  ) THEN
    ALTER TABLE wallet_transactions
      ADD CONSTRAINT wallet_transactions_trip_display_id_fkey
      FOREIGN KEY (trip_display_id) REFERENCES trips(trip_display_id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_id_fkey'
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_user_id_fkey'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  -- New operational & compliance constraints
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_timeline_order_display_id_fkey'
  ) THEN
    ALTER TABLE order_timeline
      ADD CONSTRAINT order_timeline_order_display_id_fkey
      FOREIGN KEY (order_display_id) REFERENCES orders(order_display_id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trip_items_trip_display_id_fkey'
  ) THEN
    ALTER TABLE trip_items
      ADD CONSTRAINT trip_items_trip_display_id_fkey
      FOREIGN KEY (trip_display_id) REFERENCES trips(trip_display_id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trip_stops_trip_display_id_fkey'
  ) THEN
    ALTER TABLE trip_stops
      ADD CONSTRAINT trip_stops_trip_display_id_fkey
      FOREIGN KEY (trip_display_id) REFERENCES trips(trip_display_id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'route_map_points_trip_display_id_fkey'
  ) THEN
    ALTER TABLE route_map_points
      ADD CONSTRAINT route_map_points_trip_display_id_fkey
      FOREIGN KEY (trip_display_id) REFERENCES trips(trip_display_id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_user_id_fkey'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tyre_diagnostics_truck_id_fkey'
  ) THEN
    ALTER TABLE tyre_diagnostics
      ADD CONSTRAINT tyre_diagnostics_truck_id_fkey
      FOREIGN KEY (truck_id) REFERENCES trucks(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'truck_maintenance_tickets_truck_id_fkey'
  ) THEN
    ALTER TABLE truck_maintenance_tickets
      ADD CONSTRAINT truck_maintenance_tickets_truck_id_fkey
      FOREIGN KEY (truck_id) REFERENCES trucks(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'truck_maintenance_tickets_driver_id_fkey'
  ) THEN
    ALTER TABLE truck_maintenance_tickets
      ADD CONSTRAINT truck_maintenance_tickets_driver_id_fkey
      FOREIGN KEY (driver_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saved_addresses_user_id_fkey'
  ) THEN
    ALTER TABLE saved_addresses
      ADD CONSTRAINT saved_addresses_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_methods_user_id_fkey'
  ) THEN
    ALTER TABLE payment_methods
      ADD CONSTRAINT payment_methods_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'driver_details_truck_id_fkey'
  ) THEN
    ALTER TABLE driver_details
      ADD CONSTRAINT driver_details_truck_id_fkey
      FOREIGN KEY (truck_id) REFERENCES trucks(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;

END
$$;

-- ============================================================================
-- Indexes for optimized foreign key checks and join operations
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_wallet_txn_order ON wallet_transactions (order_display_id);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_trip ON wallet_transactions (trip_display_id);
CREATE INDEX IF NOT EXISTS idx_maint_tickets_driver ON truck_maintenance_tickets (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_details_truck ON driver_details (truck_id);

-- ============================================================================
-- Rollback Instructions
-- ============================================================================
-- To roll back this migration and remove all added foreign key constraints,
-- execute the following statements:
--
-- ALTER TABLE driver_details DROP CONSTRAINT IF EXISTS driver_details_user_id_fkey;
-- ALTER TABLE customer_stats DROP CONSTRAINT IF EXISTS customer_stats_user_id_fkey;
-- ALTER TABLE trucks DROP CONSTRAINT IF EXISTS trucks_driver_id_fkey;
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_customer_id_fkey;
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_driver_id_fkey;
-- ALTER TABLE load_offers DROP CONSTRAINT IF EXISTS load_offers_customer_id_fkey;
-- ALTER TABLE load_bids DROP CONSTRAINT IF EXISTS load_bids_load_id_fkey;
-- ALTER TABLE load_bids DROP CONSTRAINT IF EXISTS load_bids_driver_id_fkey;
-- ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_customer_id_fkey;
-- ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_driver_id_fkey;
-- ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_order_display_id_fkey;
-- ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_driver_id_fkey;
-- ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_order_display_id_fkey;
-- ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_trip_display_id_fkey;
-- ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
-- ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_user_id_fkey;
-- ALTER TABLE order_timeline DROP CONSTRAINT IF EXISTS order_timeline_order_display_id_fkey;
-- ALTER TABLE trip_items DROP CONSTRAINT IF EXISTS trip_items_trip_display_id_fkey;
-- ALTER TABLE trip_stops DROP CONSTRAINT IF EXISTS trip_stops_trip_display_id_fkey;
-- ALTER TABLE route_map_points DROP CONSTRAINT IF EXISTS route_map_points_trip_display_id_fkey;
-- ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_user_id_fkey;
-- ALTER TABLE tyre_diagnostics DROP CONSTRAINT IF EXISTS tyre_diagnostics_truck_id_fkey;
-- ALTER TABLE truck_maintenance_tickets DROP CONSTRAINT IF EXISTS truck_maintenance_tickets_truck_id_fkey;
-- ALTER TABLE truck_maintenance_tickets DROP CONSTRAINT IF EXISTS truck_maintenance_tickets_driver_id_fkey;
-- ALTER TABLE saved_addresses DROP CONSTRAINT IF EXISTS saved_addresses_user_id_fkey;
-- ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_user_id_fkey;
-- ALTER TABLE driver_details DROP CONSTRAINT IF EXISTS driver_details_truck_id_fkey;
--
-- DROP INDEX IF EXISTS idx_wallet_txn_order;
-- DROP INDEX IF EXISTS idx_wallet_txn_trip;
-- DROP INDEX IF EXISTS idx_maint_tickets_driver;
-- DROP INDEX IF EXISTS idx_driver_details_truck;
-- ============================================================================
