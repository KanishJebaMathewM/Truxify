-- ============================================================================
-- ZK-ID VERIFICATION CHALLENGES
-- ============================================================================
-- Persist server-issued challenge nonces so each nonce can be consumed once,
-- independently of backend process lifetime or instance count.
-- ============================================================================

create table if not exists zkid_verification_challenges (
  nonce             text not null,
  identity_hash     text not null,
  credential_hash   text not null,
  chain_id          bigint not null,
  contract_address  text not null,
  issued_at         timestamptz not null,
  expires_at        timestamptz not null,
  used_at           timestamptz,
  created_at        timestamptz not null default now(),
  primary key (nonce),
  constraint fk_zkid_challenges_identity
    foreign key (identity_hash)
    references zkid_identities (identity_hash)
    on delete restrict,
  constraint fk_zkid_challenges_credential
    foreign key (credential_hash)
    references zkid_credentials (credential_hash)
    on delete restrict,
  constraint chk_zkid_challenges_expiry
    check (expires_at > issued_at)
);

create index if not exists idx_zkid_challenges_expiry
  on zkid_verification_challenges (expires_at);

create index if not exists idx_zkid_challenges_identity
  on zkid_verification_challenges (identity_hash);

alter table zkid_verification_challenges enable row level security;

drop policy if exists "Service role full access on zkid_verification_challenges"
  on zkid_verification_challenges;
create policy "Service role full access on zkid_verification_challenges"
  on zkid_verification_challenges
  for all to service_role
  using (true)
  with check (true);

revoke all on table zkid_verification_challenges from anon, authenticated;
