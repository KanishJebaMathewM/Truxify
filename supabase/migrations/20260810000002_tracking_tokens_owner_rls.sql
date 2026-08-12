-- Fix #8937: allow authenticated users to create/revoke their own tracking tokens.
--
-- trackingRoutes.js now mints and revokes share links through
-- createUserClient(req.token), but tracking_tokens only shipped
-- service_role-ALL and authenticated-SELECT policies, so the INSERT (create)
-- and UPDATE (revoke) still fail with 42501. These policies scope every
-- write to tokens the caller created (created_by = own profile id).

alter table tracking_tokens enable row level security;

drop policy if exists "Customers insert own tracking tokens" on tracking_tokens;
create policy "Customers insert own tracking tokens"
  on tracking_tokens for insert to authenticated
  with check (created_by = get_profile_id());

drop policy if exists "Customers update own tracking tokens" on tracking_tokens;
create policy "Customers update own tracking tokens"
  on tracking_tokens for update to authenticated
  using (created_by = get_profile_id())
  with check (created_by = get_profile_id());
