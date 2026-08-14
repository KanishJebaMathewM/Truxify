-- Migration: add kyc_status and kyc_doc_number to driver_details
-- ============================================================================
-- The KYC flow (verificationRoutes.js, service-role) writes kyc_status
-- ('Pending KYC' / 'Verified' / 'Rejected') and kyc_doc_number on
-- driver_details, and the driver profile (driverRoutes.js, ProfileModel.js)
-- reads kyc_status back with a fallback of 'Unverified'. Neither column was
-- ever created, so every KYC review update failed (PostgREST PGRST204 unknown
-- column) and the driver profile always reported 'Unverified'.
--
-- The new columns are covered by the existing RLS/column-privilege setup:
-- service_role keeps full table access (20240101000000_rls.sql) so
-- verificationRoutes.js can update them, and clients can read the status via
-- the existing "Drivers select own driver_details" policy.
-- ============================================================================

alter table driver_details
  add column if not exists kyc_status text not null default 'Unverified';

alter table driver_details
  add column if not exists kyc_doc_number text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'driver_details_kyc_status_check'
  ) then
    alter table driver_details
      add constraint driver_details_kyc_status_check
      check (kyc_status in ('Unverified', 'Pending KYC', 'Verified', 'Rejected'));
  end if;
end
$$;
