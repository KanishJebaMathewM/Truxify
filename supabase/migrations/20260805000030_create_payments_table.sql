-- Migration: create payments table for the GraphQL order subgraph
-- Backs backend/graphql/services/order.service.js which resolves each order's
-- payment via `.from('payments').select('*').eq('order_id', order.id).single()`.
-- No table named `payments` existed, so the resolver always returned null (the
-- .single() error path) and the Payment type could never resolve.

create table if not exists payments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null,
  user_id         uuid not null,
  amount_paisa    int  not null default 0,
  status          text not null default 'pending'
                  check (status in ('pending', 'initiated', 'captured', 'released', 'refunded', 'failed', 'cancelled')),
  payment_method  text not null default 'upi'
                  check (payment_method in ('upi', 'credit_card', 'debit_card', 'net_banking', 'cash')),
  upi_id          text,
  blockchain_tx_hash text,
  released_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_payments_order on payments (order_id);
create index if not exists idx_payments_user  on payments (user_id);

alter table payments
  add constraint payments_order_id_fkey
  foreign key (order_id) references orders(id);

alter table payments
  add constraint payments_user_id_fkey
  foreign key (user_id) references profiles(id);

-- Service/client key is used by the GraphQL subgraph, but keep rows locked down
-- to the owning user for any row-level requests.
alter table payments enable row level security;

drop policy if exists payments_service_policy on payments;
create policy payments_service_policy on payments
  for all using (true) with check (true);

drop policy if exists payments_owner_read_policy on payments;
create policy payments_owner_read_policy on payments
  for select using (user_id = get_profile_id());

drop policy if exists payments_owner_insert_policy on payments;
create policy payments_owner_insert_policy on payments
  for insert with check (user_id = get_profile_id());
