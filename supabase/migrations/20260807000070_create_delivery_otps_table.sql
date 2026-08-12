-- Fix #7541: create the delivery_otps table that was only defined in the
-- unapplied docs/migration_add_delivery_otp.sql. notificationService writes
-- and reads delivery_otps (order_id, otp_hash, otp_salt, expires_at, verified),
-- which previously failed with PGRST204. RLS policies for this table already
-- exist in the applied RLS migration, so only the table + indexes are added.
create table if not exists delivery_otps (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  otp_hash    text not null,
  otp_salt    text,
  expires_at  timestamptz not null,
  verified    boolean not null default false,
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_delivery_otps_order_id   on delivery_otps (order_id);
create index if not exists idx_delivery_otps_expires_at on delivery_otps (expires_at);

alter table delivery_otps enable row level security;
