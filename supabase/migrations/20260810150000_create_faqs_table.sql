-- =============================================================================
-- Migration: create and seed the faqs reference table
-- =============================================================================
-- Problem:
--   GET /api/support/faqs (backend/api/src/routes/supportRoutes.js:207) queries
--   a `faqs` table that no migration ever creates. The RLS migration already
--   declares policies on faqs (20240101000000_rls.sql:424-433) and
--   revoke_anon_privileges.sql:27 revokes privileges on it, but the table itself
--   was never provisioned, so every request returned PostgREST PGRST301 and the
--   revoke statement errored on fresh provisioning.
--
-- Fix:
--   Create faqs with the columns the route selects (id, question, answer,
--   app_type, sort_order) plus is_active/created_at, enable RLS using the exact
--   policy names declared in the RLS migration, and seed a starter set of FAQs.
-- =============================================================================

begin;

create table if not exists faqs (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  answer      text not null,
  app_type    text not null default 'both',
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_faqs_active on faqs (is_active, sort_order);

-- RLS policies mirror 20240101000000_rls.sql (which referenced faqs but could
-- not attach policies to a nonexistent table). The route reads via the public
-- anon client, so anon + authenticated get SELECT on active rows only.
alter table faqs enable row level security;

drop policy if exists "Service role full access on faqs" on faqs;
create policy "Service role full access on faqs"
  on faqs for all to service_role using (true) with check (true);

drop policy if exists "Anyone can view active FAQs" on faqs;
create policy "Anyone can view active FAQs"
  on faqs for select to anon, authenticated
  using (is_active = true);

-- Seed starter FAQs (idempotent — no-ops if rows already exist).
insert into faqs (question, answer, app_type, is_active, sort_order)
select f.question, f.answer, f.app_type, true, f.sort_order
from (values
  ('How do I book a truck on Truxify?', 'Open the app, enter pickup and drop-off locations, choose a vehicle type, and submit your load. Nearby drivers receive the request and you can track the trip in real time.', 'customer', 1),
  ('How is the fare calculated?', 'Fare is based on distance, vehicle type, and any additional services such as cold-chain or detention time. You always see the estimated fare before confirming a booking.', 'customer', 2),
  ('Can I track my shipment live?', 'Yes. Once a driver accepts your load, you can follow the live location of the truck until delivery is completed.', 'customer', 3),
  ('What happens if my shipment is damaged?', 'Report the issue through Help & Support immediately after delivery. Claims are reviewed with proof of condition and resolved within the SLA stated on your booking.', 'customer', 4),
  ('How do I receive load requests?', 'When a load is posted in your area and matches your truck type, it appears in the Loads tab. Accept a load to start the trip.', 'driver', 1),
  ('When do I get paid for a trip?', 'Earnings are credited to your wallet after a trip is completed and verified. You can withdraw to your bank account at any time.', 'driver', 2),
  ('What documents do I need to drive on Truxify?', 'A valid driving licence, vehicle registration (RC book), and insurance. Upload them in your profile and they are verified before you can accept loads.', 'driver', 3),
  ('What should I do if a trip is delayed?', 'Communicate with the customer through the in-app chat and notify support if the delay affects the agreed schedule.', 'driver', 4),
  ('How do I contact support?', 'Use Help & Support in the app to raise a ticket, or browse FAQs for instant answers to common questions.', 'both', 5)
) as f(question, answer, app_type, sort_order)
where not exists (
  select 1 from faqs where faqs.question = f.question
);

commit;
