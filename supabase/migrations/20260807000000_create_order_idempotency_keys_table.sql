-- ============================================================================
-- DURABLE ORDER-CREATION IDEMPOTENCY — Postgres-Backed Claim Registry
-- ============================================================================
-- The HTTP idempotency middleware (backend/api/src/middleware/idempotency.js)
-- dedupes within a process using Redis + an in-memory fallback. That is a
-- fast path only: a process crash after create_order_tx commits but before the
-- response is cached, or a Redis restart, leaves no record of the success and
-- a retry would create a duplicate order + load offer.
--
-- This registry makes the idempotency decision durable and transactional with
-- the order itself's database:
--   - keyed on (user_id, idempotency_key) — a user can never shadow or replay
--     another user's key,
--   - fingerprints the canonical request body so a reused key with a
--     *different* payload is rejected (409) instead of silently replaying,
--   - completed responses are replayed verbatim for as long as the row lives,
--   - a failed attempt can be retried; a fresh in-flight claim returns
--     in_progress so concurrent duplicates are rejected while processing,
--   - a stale in-flight claim (crashed worker) can be re-acquired after a
--     lease interval so a retry self-heals without manual intervention.
--
-- SECURITY MODEL:
--   - Backend writes via service_role RPCs (claim / complete / prune).
--   - RLS allows service_role only; anon/authenticated get no access at all.
--   - The SECURITY DEFINER functions fail closed and are granted to
--     service_role only (mirrors secure_complete_trip_tx_auth.sql).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. IDEMPOTENCY KEY REGISTRY TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists order_idempotency_keys (
  user_id            uuid not null,       -- profiles.id (backend req.user.id)
  idempotency_key    varchar(255) not null,
  request_fingerprint text not null,      -- sha256(user_id + canonical body)
  status             text not null default 'claimed'
                     check (status in ('claimed', 'completed', 'failed')),
  response_payload   jsonb,               -- { message, order } cached for replay
  results            jsonb,               -- order row / rpc payload for audits
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

-- Pruning targets old terminal rows; index keeps the delete cheap.
create index if not exists idx_order_idempotency_keys_updated_at
  on order_idempotency_keys (updated_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
alter table order_idempotency_keys enable row level security;

drop policy if exists "Service role full access on order_idempotency_keys"
  on order_idempotency_keys;
create policy "Service role full access on order_idempotency_keys"
  on order_idempotency_keys
  for all to service_role
  using (true)
  with check (true);

revoke all on table order_idempotency_keys from anon, authenticated;
revoke all on table order_idempotency_keys from public;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. CLAIM — atomic acquire / replay / conflict resolution
-- ────────────────────────────────────────────────────────────────────────────
-- Returns one of:
--   { status: 'claimed' }            → the caller may execute the operation
--   { status: 'completed', response } → replay the stored 2xx response
--   { status: 'conflict' }           → key reused with a different payload
--   { status: 'in_progress' }        → fresh claim held by a concurrent request
-- A 'claimed' row older than p_lease_interval is treated as a crashed run and
-- re-acquired so the retry self-heals. A 'failed' row is re-acquirable
-- immediately.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function claim_order_idempotency_key(
  p_user_id uuid,
  p_key text,
  p_fingerprint text,
  p_lease_interval interval default interval '2 minutes'
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status       text;
  v_fingerprint  text;
  v_response     jsonb;
begin
  insert into order_idempotency_keys
    (user_id, idempotency_key, request_fingerprint, status)
  values
    (p_user_id, p_key, p_fingerprint, 'claimed')
  on conflict (user_id, idempotency_key) do update
    set request_fingerprint = excluded.request_fingerprint,
        status = 'claimed',
        response_payload = null,
        results = null,
        updated_at = now()
    where order_idempotency_keys.status = 'claimed'
      and order_idempotency_keys.updated_at < now() - p_lease_interval
  returning status, request_fingerprint, response_payload
    into v_status, v_fingerprint, v_response;

  if v_status is not null then
    -- Fresh claim: either a brand new key or re-claim of a stale crashed run.
    if v_fingerprint is distinct from p_fingerprint then
      return jsonb_build_object('status', 'conflict');
    end if;
    return jsonb_build_object('status', 'claimed', 'fingerprint', v_fingerprint);
  end if;

  -- Existing row is still active (fresh claim, completed, or failed).
  select status, request_fingerprint, response_payload
    into v_status, v_fingerprint, v_response
    from order_idempotency_keys
   where user_id = p_user_id
     and idempotency_key = p_key;

  if v_fingerprint is distinct from p_fingerprint then
    return jsonb_build_object('status', 'conflict');
  end if;

  if v_status = 'completed' then
    return jsonb_build_object('status', 'completed', 'response', v_response);
  end if;

  if v_status = 'failed' then
    -- Allow an immediate, safe retry of a previously failed attempt.
    update order_idempotency_keys
       set status = 'claimed',
           request_fingerprint = p_fingerprint,
           response_payload = null,
           results = null,
           updated_at = now()
     where user_id = p_user_id
       and idempotency_key = p_key
       and status = 'failed';
    return jsonb_build_object('status', 'claimed', 'fingerprint', p_fingerprint);
  end if;

  -- status = 'claimed' with a fresh lease → concurrent duplicate in flight.
  return jsonb_build_object('status', 'in_progress');
end;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. COMPLETE — record the terminal outcome for replay / retry
-- ────────────────────────────────────────────────────────────────────────────
-- Only called by the worker that holds the claim. A completed row is terminal
-- (never overwritten) so replay always returns the original response.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function complete_order_idempotency_key(
  p_user_id uuid,
  p_key text,
  p_status text,
  p_response_payload jsonb,
  p_results jsonb
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'invalid idempotency terminal status: %', p_status;
  end if;

  update order_idempotency_keys
     set status = p_status,
         response_payload = p_response_payload,
         results = p_results,
         updated_at = now()
   where user_id = p_user_id
     and idempotency_key = p_key
     and status <> 'completed';

  return jsonb_build_object('ok', true);
end;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. PRUNE — bound registry growth
-- ────────────────────────────────────────────────────────────────────────────
create or replace function prune_order_idempotency_keys(
  p_older_than interval default interval '7 days'
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from order_idempotency_keys
   where status in ('completed', 'failed')
     and updated_at < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. FUNCTION EXECUTION PRIVILEGES
-- ────────────────────────────────────────────────────────────────────────────
-- Fail closed: only the service-role backend may claim / complete / prune.
-- Clients (anon / authenticated) cannot read or mutate the registry, not even
-- through the functions.
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function claim_order_idempotency_key(uuid, text, text, interval) from public, anon, authenticated;
revoke execute on function complete_order_idempotency_key(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function prune_order_idempotency_keys(interval) from public, anon, authenticated;

grant execute on function claim_order_idempotency_key(uuid, text, text, interval) to service_role;
grant execute on function complete_order_idempotency_key(uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function prune_order_idempotency_keys(interval) to service_role;
