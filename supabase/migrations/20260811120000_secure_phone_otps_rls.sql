-- Fix #9880: phone_otps must not be readable by anon/authenticated clients.
-- 20260810160000_create_phone_otps_table.sql enabled RLS but then granted
-- anon SELECT/UPDATE policies on otp_hash + otp_salt, which defeats the salt
-- and enables offline brute-force of 6-digit OTPs. Mirror the delivery_otps
-- pattern (20240101000000_rls.sql): revoke anon/authenticated access entirely
-- and give service_role full access so the backend can use supabaseAdmin.

revoke all on table public.phone_otps from anon;
revoke all on table public.phone_otps from authenticated;

drop policy if exists "Anon read unexpired phone OTPs" on phone_otps;
drop policy if exists "Anon consume phone OTPs" on phone_otps;

drop policy if exists "Service role full access on phone_otps" on phone_otps;
create policy "Service role full access on phone_otps"
  on phone_otps for all to service_role using (true) with check (true);

drop policy if exists "service_insert_phone_otp" on phone_otps;
create policy "service_insert_phone_otp"
  on phone_otps for insert to service_role
  with check (true);

drop policy if exists "service_update_phone_otp" on phone_otps;
create policy "service_update_phone_otp"
  on phone_otps for update to service_role
  using (true) with check (true);
