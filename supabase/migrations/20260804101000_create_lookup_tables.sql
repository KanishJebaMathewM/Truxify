-- Migration: Create vehicle_types and regions lookup tables
-- Back GET /api/v1/vehicle-types and GET /api/v1/regions.

CREATE TABLE IF NOT EXISTS vehicle_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL UNIQUE,
  capacity_tonnes  numeric,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS regions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  code       text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
