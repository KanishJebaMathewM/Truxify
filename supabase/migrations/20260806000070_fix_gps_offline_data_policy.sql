-- supabase/migrations/20260806000070_fix_gps_offline_data_policy.sql

-- Drop the insecure public allow-all policy if it exists
drop policy if exists gps_offline_data_service_policy on gps_offline_data;

-- Recreate the service policy explicitly restricted to service_role
create policy gps_offline_data_service_policy on gps_offline_data
  for all 
  to service_role 
  using (true) 
  with check (true);
