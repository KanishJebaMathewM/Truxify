-- Fix #9380: enforce a single owner per Polygon wallet address.
--
-- profileRoutes PUT /wallet writes the same polygon_wallet_address to both
-- profiles and driver_details, and routes respond 409 (PGRST23505) when a
-- unique constraint fires. Neither column had a UNIQUE constraint, so the
-- same wallet could be claimed by multiple accounts and the 23505 -> 409
-- guard was dead code.
--
-- These partial unique indexes make the address globally unique. Postgres
-- partial indexes allow any number of NULL / empty rows, so users who have
-- never set a wallet are unaffected.

-- De-duplicate any pre-existing duplicates by keeping the earliest row per
-- address and clearing the wallet on the rest, otherwise the index creation
-- below would fail on existing data.
WITH duplicates AS (
  SELECT
    min(id) AS keep_id,
    polygon_wallet_address
  FROM profiles
  WHERE polygon_wallet_address IS NOT NULL AND btrim(polygon_wallet_address) <> ''
  GROUP BY polygon_wallet_address
  HAVING count(*) > 1
)
UPDATE profiles p
SET polygon_wallet_address = NULL
FROM duplicates d
WHERE p.polygon_wallet_address = d.polygon_wallet_address
  AND p.id <> d.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_polygon_wallet_address_unique
  ON profiles (polygon_wallet_address)
  WHERE polygon_wallet_address IS NOT NULL AND btrim(polygon_wallet_address) <> '';

WITH duplicates AS (
  SELECT
    min(user_id) AS keep_user_id,
    polygon_wallet_address
  FROM driver_details
  WHERE polygon_wallet_address IS NOT NULL AND btrim(polygon_wallet_address) <> ''
  GROUP BY polygon_wallet_address
  HAVING count(*) > 1
)
UPDATE driver_details dd
SET polygon_wallet_address = NULL
FROM duplicates d
WHERE dd.polygon_wallet_address = d.polygon_wallet_address
  AND dd.user_id <> d.keep_user_id;

CREATE UNIQUE INDEX IF NOT EXISTS driver_details_polygon_wallet_address_unique
  ON driver_details (polygon_wallet_address)
  WHERE polygon_wallet_address IS NOT NULL AND btrim(polygon_wallet_address) <> '';
