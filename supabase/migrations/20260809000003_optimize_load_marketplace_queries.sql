-- Migration: optimize the load marketplace board (GET /api/loads)
--
-- The board runs several hot query shapes against load_offers:
--
--   1. WHERE status = $1 ORDER BY created_at DESC, id DESC LIMIT/OFFSET
--      (default and status-filtered listings)
--   2. WHERE status = $1 ORDER BY created_at ASC, id ASC   (order=asc)
--   3. WHERE status = $1 ORDER BY freight_value [ASC|DESC], id [ASC|DESC]
--      (sort_by=estimated_price)
--   4. WHERE status = $1 AND pickup_address ILIKE '%term%' (pickup_location)
--   5. WHERE status = $1 AND drop_address ILIKE '%term%'   (destination)
--   6. SELECT count(*) WHERE status = $1                   (count=exact)
--
-- The existing single-column idx_load_offers_status is too unselective
-- (status='available' matches ~72% of rows) for the planner to use it for
-- the ORDER BY, so the default listing previously ran a Seq Scan over the
-- whole table followed by a Sort.  The composite indexes below make the
-- ordering fully index-satisfiable (no sort node, both directions), and the
-- trigram GIN indexes serve the substring searches that a btree cannot.
--
-- All statements are idempotent and safe to re-run.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- (status, created_at DESC, id DESC):
--   * WHERE status=$1 ORDER BY created_at DESC, id DESC -> pure Index Scan
--   * WHERE status=$1 ORDER BY created_at ASC, id ASC  -> backward scan
--   * WHERE status=$1 count(*)                          -> Index-Only Scan
-- The id column is part of the index so the id tie-breaker used by the API
-- does not require an Incremental Sort.
CREATE INDEX IF NOT EXISTS idx_load_offers_status_created_at_id
    ON load_offers (status, created_at DESC, id DESC);

-- (status, freight_value): serves sort_by=estimated_price listings.
CREATE INDEX IF NOT EXISTS idx_load_offers_status_freight_value
    ON load_offers (status, freight_value);

-- Trigram GIN indexes: serve pickup_location / destination substring
-- searches (ILIKE '%term%'), which a regular btree index cannot satisfy.
CREATE INDEX IF NOT EXISTS idx_load_offers_pickup_address_trgm
    ON load_offers USING GIN (pickup_address gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_load_offers_drop_address_trgm
    ON load_offers USING GIN (drop_address gin_trgm_ops);

COMMIT;
