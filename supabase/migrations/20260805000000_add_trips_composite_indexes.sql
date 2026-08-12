-- Migration: add composite indexes for the trips table hot access paths
--
-- Every driver-facing read of the trips table filters on driver_id and
-- status together and then orders by trip_date.  The existing single-column
-- indexes force Postgres to bitmap-AND two indexes and then sort the result
-- set — an external merge sort once a driver's completed-trip count grows
-- past working_mem.
--
-- This migration adds two composite indexes that match the actual query
-- shapes, and drops the now-redundant single-column idx_trips_driver (the
-- new composite index's leading column already covers those lookups).
--
-- All statements use IF NOT EXISTS / IF EXISTS so the migration is
-- idempotent and safe to re-run in any environment.

BEGIN;

-- Index 1: (driver_id, status, trip_date DESC)
--
-- Serves every earnings / trip-history query that filters on both
-- driver_id and status and orders by trip_date:
--
--   WHERE driver_id = $1 AND status = 'completed'
--   ORDER BY trip_date DESC                     (line 1477, driverRoutes.js)
--
--   WHERE driver_id = $1 AND status = 'completed'
--   ORDER BY trip_date ASC                      (line 1531, driverRoutes.js)
--
-- Postgres can satisfy both orderings from a single index scan:
-- DESC order is a forward scan; ASC order is a backward scan.
-- No bitmap AND, no external sort node.

CREATE INDEX IF NOT EXISTS idx_trips_driver_status_date
    ON trips (driver_id, status, trip_date DESC);

-- Index 2: (driver_id, trip_display_id)
--
-- Serves the ownership-check lookups (lines 629, 684, 726, 768) that
-- filter on both columns to confirm a trip belongs to the requesting
-- driver before returning its detail.  Without this, each check required
-- a heap fetch after an index scan on trip_display_id alone.

CREATE INDEX IF NOT EXISTS idx_trips_driver_display
    ON trips (driver_id, trip_display_id);

-- Drop the now-redundant single-column index.
--
-- idx_trips_driver_status_date leads with driver_id, so all queries that
-- previously used idx_trips_driver will use the composite index instead.
-- Keeping both wastes write throughput and storage on every INSERT/UPDATE.

DROP INDEX IF EXISTS idx_trips_driver;

COMMIT;
