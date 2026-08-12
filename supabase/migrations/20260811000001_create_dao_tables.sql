-- ============================================================================
-- DAO — Membership / Proposal / Vote Tables
-- ============================================================================
-- The DAO module (backend/dao/dao.service.js) persists memberships, proposals
-- and votes into `dao_members`, `dao_proposals` and `dao_votes`, and reads them
-- back for member lookups and stats. No migration previously created any of
-- them, so every operation failed with `relation ... does not exist`. This
-- migration creates all three tables with columns matching the inserts,
-- updates and selects in dao.service.js.
--
-- SECURITY MODEL:
--   - Written by backend services using service_role credentials and never
--     exposed directly to clients, so RLS allows service_role only.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. DAO MEMBERS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists dao_members (
  user_address text not null,            -- storeMember: data.userAddress
  tx_hash      text,                     -- storeMember: data.txHash
  is_active    boolean not null default true, -- storeMember: is_active / updateMemberStatus
  joined_at    timestamptz not null default now(), -- storeMember: joined_at
  left_tx_hash text,                     -- updateMemberStatus: left_tx_hash
  left_at      timestamptz,              -- updateMemberStatus: left_at
  primary key (user_address)
);

create index if not exists idx_dao_members_is_active
  on dao_members (is_active);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. DAO PROPOSALS TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists dao_proposals (
  proposal_id      text not null,        -- storeProposal: data.proposalId
  proposer         text,                 -- storeProposal: data.proposer
  title            text,                 -- storeProposal: data.title
  description      text,                 -- storeProposal: data.description
  proposal_type    text,                 -- storeProposal: data.proposalType
  tx_hash          text,                 -- storeProposal: data.txHash
  status           text not null default 'pending', -- storeProposal: status / updateProposalStatus
  created_at       timestamptz not null default now(),
  executed_tx_hash text,                 -- updateProposalStatus: executed_tx_hash
  executed_at      timestamptz,          -- updateProposalStatus: executed_at
  primary key (proposal_id)
);

create index if not exists idx_dao_proposals_status
  on dao_proposals (status);

create index if not exists idx_dao_proposals_created_at
  on dao_proposals (created_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. DAO VOTES TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists dao_votes (
  id            bigint generated always as identity primary key,
  proposal_id   text not null,           -- storeVote: data.proposalId
  voter_address text,                    -- storeVote: data.voterAddress
  voting_power  numeric,                 -- storeVote: data.votingPower
  tx_hash       text,                    -- storeVote: data.txHash
  created_at    timestamptz not null default now(),
  constraint fk_dao_votes_proposal
    foreign key (proposal_id)
    references dao_proposals (proposal_id)
    on delete restrict
);

create index if not exists idx_dao_votes_proposal_id
  on dao_votes (proposal_id);

create index if not exists idx_dao_votes_voter_address
  on dao_votes (voter_address);


-- ────────────────────────────────────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table dao_members enable row level security;
alter table dao_proposals enable row level security;
alter table dao_votes enable row level security;

drop policy if exists "Service role full access on dao_members" on dao_members;
create policy "Service role full access on dao_members"
  on dao_members
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on dao_proposals" on dao_proposals;
create policy "Service role full access on dao_proposals"
  on dao_proposals
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access on dao_votes" on dao_votes;
create policy "Service role full access on dao_votes"
  on dao_votes
  for all to service_role
  using (true)
  with check (true);

revoke all on table dao_members from anon, authenticated;
revoke all on table dao_proposals from anon, authenticated;
revoke all on table dao_votes from anon, authenticated;
