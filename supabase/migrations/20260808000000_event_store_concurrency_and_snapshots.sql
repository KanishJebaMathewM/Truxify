-- ============================================================================
-- EVENT SOURCING — Optimistic concurrency + functional snapshots
-- ============================================================================
-- Fixes three correctness issues in the eventsourcing module
-- (backend/eventsourcing/event-store.js):
--
--   1. No uniqueness on (aggregate_id, version). Concurrent commands read the
--      current version and both try to insert the same next version, so
--      duplicate versions are possible. This migration adds a UNIQUE index on
--      (aggregate_id, version); the app now inserts with
--      INSERT ... ON CONFLICT DO NOTHING so the constraint is the final
--      safety mechanism for optimistic concurrency.
--
--   2. The `snapshots` table the module writes to (takeSnapshot) was never
--      created by any migration, so snapshot writes always failed and reads
--      always returned null. This migration creates it.
--
--   3. `version` was nullable. A NULL version cannot satisfy the
--      "one event per (aggregate_id, version)" invariant, so the column is
--      made NOT NULL after the null rows are detected below.
--
-- DUPLICATE / NULL DATA REMEDIATION
-- --------------------------------
-- This migration NEVER deletes or rewrites event history. Instead it fails
-- safely when the data cannot support the invariant, with these steps for an
-- operator to follow:
--
--   a) Duplicate (aggregate_id, version) pairs:
--        SELECT aggregate_id, version, count(*)
--        FROM event_store
--        WHERE version IS NOT NULL
--        GROUP BY aggregate_id, version
--        HAVING count(*) > 1;
--      Review each group. If both rows are genuine duplicates of the same
--      event, keep the authoritative row (same payload) and delete the other
--      copy. If the payloads differ, one is a write that lost a race and must
--      be retired manually. Then re-run this migration.
--
--   b) NULL versions:
--        SELECT * FROM event_store WHERE version IS NULL;
--      Such rows are malformed (the app always persists a version). Decide per
--      row whether it is authoritative and, if so, assign it the next
--      available version for its aggregate; otherwise remove it. Then re-run
--      this migration.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. SAFETY CHECKS — fail instead of silently destroying data
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  n_dups bigint;
  n_nulls bigint;
begin
  select count(*) into n_dups
  from (
    select aggregate_id, version, count(*)
    from event_store
    where version is not null
    group by aggregate_id, version
    having count(*) > 1
  ) duplicates;

  if n_dups > 0 then
    raise exception
      'event_store contains % duplicate (aggregate_id, version) pairs; '
      'manual remediation required before the unique constraint can be enforced '
      '(see migration header comments).',
      n_dups;
  end if;

  select count(*) into n_nulls
  from event_store
  where version is null;

  if n_nulls > 0 then
    raise exception
      'event_store contains % row(s) with a NULL version; '
      'NULL versions cannot satisfy the (aggregate_id, version) uniqueness '
      'invariant and must be reviewed manually before this migration.',
      n_nulls;
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. UNIQUE VERSION INVARIANT
-- ────────────────────────────────────────────────────────────────────────────
alter table event_store
  alter column version set not null;

-- One event per (aggregate_id, version). A UNIQUE index is used (rather than
-- a UNIQUE constraint) so PostgREST `on_conflict=aggregate_id,version` and
-- `INSERT ... ON CONFLICT ... DO NOTHING` can target it.
create unique index if not exists uq_event_store_aggregate_version
  on event_store (aggregate_id, version);

-- The old non-unique index on the same columns is now redundant.
drop index if exists idx_event_store_aggregate_version;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. SNAPSHOTS TABLE
-- ────────────────────────────────────────────────────────────────────────────
-- One snapshot per aggregate (upserted on `aggregate_id`). `version` is the
-- aggregate version the snapshot represents; `snapshot_version` is the
-- snapshot schema version so consumers can detect incompatible snapshots and
-- fall back to a full replay instead of trusting corrupted state.
create table if not exists snapshots (
  aggregate_id     text primary key,
  version          integer not null check (version >= 0),
  state            jsonb not null,
  snapshot_version integer not null default 1 check (snapshot_version >= 1),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_snapshots_version
  on snapshots (version);


-- ────────────────────────────────────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY (mirrors event_store: service_role only)
-- ────────────────────────────────────────────────────────────────────────────
alter table snapshots enable row level security;

drop policy if exists "Service role full access on snapshots"
  on snapshots;
create policy "Service role full access on snapshots"
  on snapshots
  for all to service_role
  using (true)
  with check (true);

revoke all on table snapshots from anon, authenticated;
