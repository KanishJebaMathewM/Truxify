-- Migration: create vehicle_types and regions reference tables
-- Backs backend/api/src/routes/lookupRoutes.js which serves GET /vehicle-types
-- and GET /regions from `.from('vehicle_types').select('*')` and
-- `.from('regions').select('*')`. Neither table existed, so both endpoints
-- returned 500 for every request.
-- The RLS policies below use the exact names asserted by
-- backend/api/test/unit/rlsSecurity.test.js.

-- ============ vehicle_types ============
create table if not exists vehicle_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  max_capacity_tons numeric(8,2),
  min_capacity_tons numeric(8,2),
  length_ft   numeric(6,2),
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_vehicle_types_active on vehicle_types (is_active, sort_order);

-- Seed with the same truck_type values the trucks table accepts.
insert into vehicle_types (name, is_active, sort_order)
select v.name, true, v.sort_order
from (values
  ('Open Body', 1),
  ('Closed Body', 2),
  ('Container', 3),
  ('Refrigerated', 4)
) as v(name, sort_order)
where not exists (select 1 from vehicle_types where vehicle_types.name = v.name);

-- ============ regions ============
create table if not exists regions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  state       text,
  country     text not null default 'IN',
  latitude    double precision,
  longitude   double precision,
  radius_km   double precision not null default 50,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists idx_regions_active on regions (is_active);

-- ============ RLS: anon + authenticated can read reference data ============
alter table vehicle_types enable row level security;
alter table regions enable row level security;

create policy "Anyone can view vehicle types"
  on vehicle_types for select
  to anon, authenticated
  using (is_active = true);

create policy "Anyone can view regions"
  on regions for select
  to anon, authenticated
  using (is_active = true);
