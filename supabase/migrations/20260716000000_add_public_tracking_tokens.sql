-- ============================================================================
-- PUBLIC ORDER TRACKING — Share Tokens
-- ============================================================================
-- Adds a dedicated table for cryptographic tracking share tokens and
-- token metadata columns on the orders table.
--
-- SECURITY MODEL:
--   - Tokens are stored as SHA-256 hashes (never plaintext in DB).
--   - The raw token is only returned once at creation time.
--   - Tokens expire after 7 days OR when the order reaches a terminal
--     status (delivered / cancelled / payment_released).
--   - Tokens can be individually revoked by the customer.
--   - The public GET endpoint uses the service_role key (bypasses RLS)
--     and performs its own authorization checks.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. TRACKING TOKENS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists tracking_tokens (
  id              uuid primary key default gen_random_uuid(),
  order_display_id text not null,                               -- orders.order_display_id
  token_hash      text unique not null,                         -- SHA-256 hash of the raw token
  created_by      uuid not null,                                -- profiles.id (customer who shared)
  expires_at      timestamptz not null,                         -- max 7 days from creation
  revoked         boolean not null default false,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_tracking_tokens_hash   on tracking_tokens (token_hash);
create index if not exists idx_tracking_tokens_order  on tracking_tokens (order_display_id);
create index if not exists idx_tracking_tokens_expiry on tracking_tokens (expires_at);

alter table tracking_tokens
  add constraint tracking_tokens_order_display_id_fkey
  foreign key (order_display_id) references orders(order_display_id)
  on update cascade on delete cascade;

alter table tracking_tokens
  add constraint tracking_tokens_created_by_fkey
  foreign key (created_by) references profiles(id)
  on update cascade on delete restrict;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table tracking_tokens enable row level security;

-- Service-role full access (backend API uses this key, bypasses RLS)
create policy "Service role full access on tracking_tokens"
  on tracking_tokens for all
  to service_role
  using (true) with check (true);

-- Customers can see their own tokens
create policy "Customers select own tracking tokens"
  on tracking_tokens for select
  to authenticated
  using (created_by = (select id from profiles where firebase_uid = (auth.jwt() ->> 'sub') limit 1));


-- ────────────────────────────────────────────────────────────────────────────
-- 3. AUTO-EXPIRE TOKENS WHEN ORDER REACHES TERMINAL STATUS
-- ────────────────────────────────────────────────────────────────────────────
-- This trigger fires on order status updates and revokes all active
-- tracking tokens for orders that reach a terminal state.
-- ============================================================================

create or replace function revoke_tracking_tokens_on_terminal_status()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.status in ('delivered', 'cancelled', 'payment_released') then
    update tracking_tokens
      set revoked = true,
          revoked_at = now()
    where order_display_id = new.order_display_id
      and revoked = false
      and expires_at > now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_revoke_tracking_tokens on orders;
create trigger trg_revoke_tracking_tokens
  after update of status on orders
  for each row
  when (new.status in ('delivered', 'cancelled', 'payment_released'))
  execute function revoke_tracking_tokens_on_terminal_status();


-- ────────────────────────────────────────────────────────────────────────────
-- 4. CLEANUP EXPIRED TOKENS (optional — run via pg_cron or application)
-- ────────────────────────────────────────────────────────────────────────────
-- Tokens past their expires_at are soft-revoked by the application layer
-- during validation. No hard-delete needed for security audit trail.
