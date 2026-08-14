-- ============================================================================
-- ZERO-KNOWLEDGE IDENTITY (ZKID) — Identity, Credential & Disclosure Tables
-- ============================================================================
-- The ZKID module (backend/zkid/zkid.service.js) persists zero-knowledge identity,
-- credential, verification, and selective disclosure records into `zkid_identities`,
-- `zkid_credentials`, `zkid_verifications`, and `zkid_disclosures`, and reads them
-- back for identity queries and stats.
--
-- No migration previously created these tables, causing operations to fail with
-- `relation "public.zkid_identities" does not exist`. This migration creates all
-- four tables with columns matching the database calls in zkid.service.js.
--
-- SECURITY MODEL:
--   - Written by backend services using service_role credentials and never exposed
--     directly to public client queries, so RLS allows service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. ZKID IDENTITIES TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists zkid_identities (
  identity_hash text not null,          -- storeIdentity: data.identityHash
  user_address  text not null,          -- data.userAddress
  tx_hash       text,                   -- data.txHash
  is_active     boolean not null default true, -- getZKIDStats: activeIdentities filter
  created_at    timestamptz not null default now(),
  primary key (identity_hash)
);

create index if not exists idx_zkid_identities_user_address
  on zkid_identities (user_address);

create index if not exists idx_zkid_identities_created_at
  on zkid_identities (created_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ZKID CREDENTIALS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists zkid_credentials (
  credential_hash text not null,        -- storeCredential: data.credentialHash
  identity_hash   text not null,        -- data.identityHash
  credential_type text not null,        -- data.credentialType
  tx_hash         text,                 -- data.txHash
  revoked         boolean not null default false, -- updateCredentialStatus: revoked
  issued_at       timestamptz not null default now(), -- data.issuedAt / timestamp
  revoked_at      timestamptz,          -- updateCredentialStatus: revoked_at
  primary key (credential_hash),
  constraint fk_zkid_credentials_identity
    foreign key (identity_hash)
    references zkid_identities (identity_hash)
    on delete restrict
);

create index if not exists idx_zkid_credentials_identity_hash
  on zkid_credentials (identity_hash);

create index if not exists idx_zkid_credentials_revoked
  on zkid_credentials (revoked);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. ZKID VERIFICATIONS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists zkid_verifications (
  request_id      text not null,        -- storeVerificationRequest: data.requestId
  identity_hash   text not null,        -- data.identityHash
  credential_hash text not null,        -- data.credentialHash
  tx_hash         text,                 -- data.txHash
  verified        boolean not null default true, -- data.verified
  created_at      timestamptz not null default now(),
  primary key (request_id),
  constraint fk_zkid_verifications_identity
    foreign key (identity_hash)
    references zkid_identities (identity_hash)
    on delete restrict,
  constraint fk_zkid_verifications_credential
    foreign key (credential_hash)
    references zkid_credentials (credential_hash)
    on delete restrict
);

create index if not exists idx_zkid_verifications_identity_hash
  on zkid_verifications (identity_hash);

create index if not exists idx_zkid_verifications_credential_hash
  on zkid_verifications (credential_hash);


-- ────────────────────────────────────────────────────────────────────────────
-- 4. ZKID DISCLOSURES TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists zkid_disclosures (
  disclosure_id        text not null,   -- storeSelectiveDisclosure: data.disclosureId
  identity_hash        text not null,   -- data.identityHash
  disclosed_attributes jsonb not null,  -- data.disclosedAttributes
  recipient            text not null,   -- data.recipient
  tx_hash              text,            -- data.txHash
  created_at           timestamptz not null default now(),
  primary key (disclosure_id),
  constraint fk_zkid_disclosures_identity
    foreign key (identity_hash)
    references zkid_identities (identity_hash)
    on delete restrict
);

create index if not exists idx_zkid_disclosures_identity_hash
  on zkid_disclosures (identity_hash);

create index if not exists idx_zkid_disclosures_recipient
  on zkid_disclosures (recipient);


-- ────────────────────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY & PERMISSIONS
-- ────────────────────────────────────────────────────────────────────────────
alter table zkid_identities enable row level security;
alter table zkid_credentials enable row level security;
alter table zkid_verifications enable row level security;
alter table zkid_disclosures enable row level security;

-- Service role policies
drop policy if exists "Service role full access on zkid_identities" on zkid_identities;
create policy "Service role full access on zkid_identities"
  on zkid_identities
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on zkid_credentials" on zkid_credentials;
create policy "Service role full access on zkid_credentials"
  on zkid_credentials
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on zkid_verifications" on zkid_verifications;
create policy "Service role full access on zkid_verifications"
  on zkid_verifications
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on zkid_disclosures" on zkid_disclosures;
create policy "Service role full access on zkid_disclosures"
  on zkid_disclosures
  for all to service_role
  using (true)
  with check (true);

-- Revoke direct access from public/unauthenticated roles
revoke all on table zkid_identities from anon, authenticated;
revoke all on table zkid_credentials from anon, authenticated;
revoke all on table zkid_verifications from anon, authenticated;
revoke all on table zkid_disclosures from anon, authenticated;
