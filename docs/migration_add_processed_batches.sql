create table if not exists processed_batches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  user_id uuid not null,
  event_count int not null default 0,
  processed_at timestamptz not null default now(),
  constraint processed_batches_user_idempotency_unique unique (user_id, idempotency_key)
);

create index if not exists idx_processed_batches_user_id
on processed_batches (user_id);

create index if not exists idx_processed_batches_processed_at
on processed_batches (processed_at);

-- Enable RLS
alter table processed_batches enable row level security;

-- RLS Policies
create policy "Service role full access on processed_batches"
  on processed_batches for all
  to service_role
  using (true) with check (true);

create policy "Users view own processed batches"
  on processed_batches for select
  to authenticated
  using (user_id = get_profile_id());

