-- ============================================================================
-- DID & CREDENTIAL RECORDS — self-sovereign identity + verifiable credentials
-- ============================================================================
-- Backend services (backend/did/did.service.js) persist issued DIDs and
-- credentials here as an off-chain index of the DIDRegistry/IdentityWallet
-- smart contracts. The on-chain contract state remains the source of truth.
--
-- SECURITY MODEL:
--   - Written by backend services using the service_role key and never exposed
--     to clients, so RLS allows service_role only.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. DIDS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists dids (
  did        varchar(255) primary key,       -- did:truxify:<uuid>
  owner      varchar(255) not null,          -- polygon wallet address
  public_key text,                           -- multibase-encoded public key
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_dids_owner
  on dids (owner);

create index if not exists idx_dids_created_at
  on dids (created_at);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. CREDENTIALS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists credentials (
  credential_id  varchar(255) primary key,  -- on-chain bytes32 id
  subject        varchar(255) not null,     -- polygon wallet address
  credential_type text not null,
  schema         jsonb,
  issued_at      timestamptz not null default now(),
  valid_until    timestamptz,
  tx_hash        text,
  proof          text,
  revoked        boolean not null default false,
  revoked_at     timestamptz
);

create index if not exists idx_credentials_subject
  on credentials (subject);

create index if not exists idx_credentials_issued_at
  on credentials (issued_at);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table dids enable row level security;

drop policy if exists "Service role full access on dids"
  on dids;
create policy "Service role full access on dids"
  on dids
  for all to service_role
  using (true)
  with check (true);

revoke all on table dids from anon, authenticated;

alter table credentials enable row level security;

drop policy if exists "Service role full access on credentials"
  on credentials;
create policy "Service role full access on credentials"
  on credentials
  for all to service_role
  using (true)
  with check (true);

revoke all on table credentials from anon, authenticated;
