-- ============================================================================
-- ENCRYPTED WALLET KEYS — per-device encrypted private keys
-- ============================================================================
-- Backend services (keyManagementService.js) persist wallet private keys that
-- are encrypted with a device-derived AES-256-GCM key. The service writes via
-- the service_role client and the table is never exposed to clients, so RLS
-- allows service_role only.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. ENCRYPTED WALLET KEYS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists encrypted_wallet_keys (
  key_id         uuid primary key,
  user_id        uuid not null references profiles(id) on delete cascade,
  wallet_address varchar(255) not null,
  encrypted_key  jsonb not null,               -- iv, encryptedKey, authTag, salt, algorithm
  device_id      varchar(255),
  version        int not null default 1,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz,
  archived_at    timestamptz,
  archive_reason varchar(255)
);

create index if not exists idx_encrypted_keys_user_wallet
  on encrypted_wallet_keys (user_id, wallet_address);

create index if not exists idx_encrypted_keys_active
  on encrypted_wallet_keys (active);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table encrypted_wallet_keys enable row level security;

drop policy if exists "Service role full access on encrypted_wallet_keys"
  on encrypted_wallet_keys;
create policy "Service role full access on encrypted_wallet_keys"
  on encrypted_wallet_keys
  for all to service_role
  using (true)
  with check (true);

revoke all on table encrypted_wallet_keys from anon, authenticated;
