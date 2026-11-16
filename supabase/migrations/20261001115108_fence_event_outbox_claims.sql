-- Keep a live claim exclusive and fence settlement with its attempt generation.
-- Use the canonical event_outbox queue; no new public API permissions.
begin;

create or replace function public.claim_leased_outbox_events(
  p_limit integer default 50,
  p_lease_ms integer default 300000
)
returns setof public.event_outbox
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000
     or p_lease_ms is null or p_lease_ms < 1 or p_lease_ms > 3600000 then
    raise exception 'Invalid outbox claim limit or lease duration' using errcode = '22023';
  end if;
  return query
  with due as (
    select event_id from public.event_outbox
    where status in ('pending', 'publishing')
      and next_attempt_at <= clock_timestamp()
    order by created_at, event_id
    limit p_limit
    for update skip locked
  )
  update public.event_outbox e
     set status = 'publishing',
         attempts = e.attempts + 1,
         next_attempt_at = clock_timestamp() + p_lease_ms * interval '1 millisecond',
         last_error = null
    from due
   where e.event_id = due.event_id
  returning e.*;
end;
$$;

create or replace function public.settle_leased_outbox_event(
  p_event_id text,
  p_claim_attempt integer,
  p_published boolean,
  p_error text default null,
  p_retry_ms integer default 1000
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_matched integer;
begin
  if p_claim_attempt is null or p_claim_attempt < 1 or p_published is null
     or p_retry_ms is null or p_retry_ms < 0 or p_retry_ms > 86400000 then
    raise exception 'Invalid outbox settlement parameters' using errcode = '22023';
  end if;
  update public.event_outbox
     set status = case when p_published then 'published' else 'pending' end,
         published_at = case when p_published then clock_timestamp() else null end,
         last_error = case when p_published then null else left(p_error, 1000) end,
         next_attempt_at = case when p_published then next_attempt_at
             else clock_timestamp() + p_retry_ms * interval '1 millisecond' end
   where event_id = p_event_id
     and status = 'publishing'
     and attempts = p_claim_attempt
     and next_attempt_at > clock_timestamp();
  get diagnostics v_matched = row_count;
  return v_matched = 1;
end;
$$;

create or replace function public.renew_leased_outbox_event(
  p_event_id text, p_claim_attempt integer, p_lease_ms integer default 300000
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_matched integer;
begin
  if p_lease_ms is null or p_lease_ms < 1 or p_lease_ms > 3600000 then
    raise exception 'Invalid outbox lease duration' using errcode = '22023';
  end if;
  update public.event_outbox
     set next_attempt_at = greatest(next_attempt_at, clock_timestamp() + p_lease_ms * interval '1 millisecond')
   where event_id = p_event_id and status = 'publishing'
     and attempts = p_claim_attempt and next_attempt_at > clock_timestamp();
  get diagnostics v_matched = row_count;
  return v_matched = 1;
end;
$$;

revoke all on function public.renew_leased_outbox_event(text, integer, integer) from public, anon, authenticated;
grant execute on function public.renew_leased_outbox_event(text, integer, integer) to service_role;

revoke all on function public.claim_leased_outbox_events(integer, integer) from public, anon, authenticated;
revoke all on function public.settle_leased_outbox_event(text, integer, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.claim_leased_outbox_events(integer, integer) to service_role;
grant execute on function public.settle_leased_outbox_event(text, integer, boolean, text, integer) to service_role;

commit;
