-- Composite indexes for the hottest access paths on `trips`.
--
-- Every driver-facing read filters on driver_id and status together and then
-- orders by trip_date. The schema only had separate single-column indexes on
-- each, so Postgres could not satisfy any of these with one ordered scan — it
-- combined indexes via a bitmap AND, rechecked rows against the heap, then
-- sorted for the ORDER BY.
--
-- Query shapes this serves (backend/api/src/routes/driverRoutes.js):
--   1477  driver_id, status='completed', trip_date >= cutoff  ORDER BY trip_date DESC
--   1489  driver_id, status='completed'                        COUNT
--   1531  driver_id, status='completed', trip_date >= cutoff  ORDER BY trip_date ASC
--   629+  trip_display_id, driver_id                           ownership checks
--
-- Purely additive and idempotent — nothing is dropped.
--
-- The single-column idx_trips_driver becomes redundant once the composite
-- exists (a composite leading with driver_id serves driver_id-only lookups
-- too), but it is deliberately left in place here: scripts/verify-db-schema.js
-- expects an index named `trips_driver_idx` while the migrations create
-- `idx_trips_driver`, so the naming is already inconsistent across the repo.
-- Reconciling that deserves its own change with a live database to verify
-- against, rather than being bundled into a performance fix.

BEGIN;

-- Serves the three earnings/analytics queries. trip_date DESC matches the
-- dominant ordering; Postgres can scan a b-tree backwards, so the ASC variant
-- at line 1531 is served by the same index.
CREATE INDEX IF NOT EXISTS idx_trips_driver_status_date
  ON public.trips (driver_id, status, trip_date DESC);

-- Serves the per-trip ownership checks, which filter on both columns before
-- returning trip items, stops or route points.
CREATE INDEX IF NOT EXISTS idx_trips_driver_display
  ON public.trips (driver_id, trip_display_id);

COMMENT ON INDEX public.idx_trips_driver_status_date IS
  'Composite index for driver earnings and trip-history queries: filters on '
  '(driver_id, status) and satisfies ORDER BY trip_date without a sort node.';

COMMIT;
