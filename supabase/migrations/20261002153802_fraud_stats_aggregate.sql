-- Read the complete history in one statement; the API receives five scalars.
-- Keep caller privileges/RLS and existing table policies unchanged.
create or replace function public.get_fraud_stats_aggregate()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'total', count(*),
    'highRisk', count(*) filter (where score > 0.7),
    'mediumRisk', count(*) filter (where score > 0.4 and score <= 0.7),
    'lowRisk', count(*) filter (where score <= 0.4),
    'avgScore', coalesce(avg(score), 0)
  )
  from (
    -- Match the JavaScript numeric representation used by the former reducer,
    -- including when an installation's risk_score column is PostgreSQL numeric.
    select risk_score::double precision as score
    from public.fraud_risk_scores
  ) scores;
$function$;

revoke all on function public.get_fraud_stats_aggregate() from public, anon, authenticated;
grant execute on function public.get_fraud_stats_aggregate() to service_role;
