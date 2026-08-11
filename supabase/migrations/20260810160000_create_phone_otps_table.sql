-- Fix #9243: create the phone_otps table that /api/auth/verify-otp reads and
-- updates but no migration ever creates. The only prior SQL reference was
-- 20260805162012_add_otp_salt_to_phone_otps.sql, an ALTER against a table that
-- did not exist, so fresh databases failed with PGRST204 ("relation phone_otps
-- does not exist") on every verification attempt. Mirrors the #7541
-- delivery_otps fix.
--
-- The route uses the anon-key supabase client because verify-otp runs before a
-- user is authenticated, so RLS policies let that client look up and consume
-- unexpired OTP rows while keeping expired/verified rows invisible.
create table if not exists phone_otps (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  otp_hash    text not null,
  otp_salt    text,
  expires_at  timestamptz not null,
  verified    boolean not null default false,
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_phone_otps_phone      on phone_otps (phone);
create index if not exists idx_phone_otps_expires_at on phone_otps (expires_at);

alter table phone_otps enable row level security;

drop policy if exists "Anon read unexpired phone OTPs" on phone_otps;
create policy "Anon read unexpired phone OTPs"
  on phone_otps for select to anon, authenticated
  using (verified = false and expires_at > now());

drop policy if exists "Anon consume phone OTPs" on phone_otps;
create policy "Anon consume phone OTPs"
  on phone_otps for update to anon, authenticated
  using (verified = false and expires_at > now());
