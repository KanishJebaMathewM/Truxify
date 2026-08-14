-- ============================================================================
-- ZKID DISCLOSURES — SOFT-REVOKE COLUMN
-- ============================================================================
-- revokeSelectiveDisclosure (backend/zkid/zkid.service.js) revokes a selective
-- disclosure off-chain, since the ZKIdentity contract exposes no disclosure API.
-- The table previously had no way to record a revocation.
-- ============================================================================

alter table zkid_disclosures
  add column if not exists revoked boolean not null default false,
  add column if not exists revoked_at timestamptz;

create index if not exists idx_zkid_disclosures_revoked
  on zkid_disclosures (revoked);
