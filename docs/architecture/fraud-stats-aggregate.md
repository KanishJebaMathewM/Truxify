# Fraud statistics: database aggregation

The mounted `GET /api/fraud/stats` caller receives the existing five fields from `FraudDetectionService.getFraudStats()`. The prior paginated implementation retained the entire risk history in API memory, then filtered it three times and reduced it once. A controlled actual-service fixture with 100,000 rows made 101 page reads and transferred 100,000 individual records.

`get_fraud_stats_aggregate()` now computes count, three risk buckets and average in one PostgreSQL statement. One RPC returns one JSON object regardless of history length. API history storage and returned row count are O(1); database scan work remains O(N), and database resource use/latency still depend on the history and query plan. No cache, materialized view, database work budget or bounded scan-time guarantee is introduced.

## Compatibility

- Keep `total`, `highRisk`, `mediumRisk`, `lowRisk`, `avgScore` and the existing boundaries: high >0.7, medium >0.4 and <=0.7, low <=0.4. These dashboard buckets intentionally differ from the separate getRiskLevel labels; that logic is unchanged.
- Empty/unconfigured databases yield five zeros. Returned database errors also log and yield zeros, matching the prior policy; transport rejections still propagate. Malformed/nonfinite aggregate values yield logged zeros, never partial results.
- The SQL casts scores to double precision to match the API's former numeric representation across the existing numeric/double-precision schema variants. Ordinary finite scores are supported. PostgreSQL and JavaScript floating accumulation can differ in the final few bits; the average is not rounded or promised bit-identical.
- All totals come from one statement snapshot instead of separate page-read snapshots. This does not give a multi-request transaction or pin later writes.
- The function is STABLE, SECURITY INVOKER, schema-qualified, with an empty search path. Revoke its default execution privilege from PUBLIC/anon/authenticated; grant only service_role. Existing table privileges and policies remain unchanged; no privilege elevation is introduced.

## Rollout

Apply `supabase/migrations/20261002153802_fraud_stats_aggregate.sql` through the normal reviewed migration process **before** deploying this API change. Confirm the RPC is visible through PostgREST and that the existing service caller can read the table. If the function is missing or migration/schema-cache rollout fails, the API logs that database error and returns the existing zero fallback; it deliberately does not restore an unbounded history download. No live migration or deployment was performed for this contribution. Rolling back the API to the old implementation does not require dropping the additive function.

## Verification

Run `npm ci --prefix tools/fraud-aggregate-tests --ignore-scripts` and `bash tools/fraud-aggregate-tests/run.sh`. The isolated harness copies the actual service and repository schema/migration files; PGlite runs real PostgreSQL locally without production records. Coverage includes empty/boundary/numeric/double-precision and 100,000-row same-timestamp histories, malformed/error/transport behavior, execution privileges, a restrictive caller-visible policy and migration reapplication. Existing stats guards and the top-level FraudDetectionService suite use the new RPC contract; the unchanged existing service suite and the relevant core stats test also run. Thirty unrelated core-suite cases are outside this focused selection. The old pagination suite already imports a nonexistent named class and assumes a different paginated response contract; it is not repaired or claimed passing here.

The focused workflow runs the same checks on Node22/Linux. No whole-monorepo, live Supabase/PostgREST or deployment validation is claimed. The CLI-generated migration and catalog/role/policy tests pass locally; `supabase db advisors --local` was unavailable because no local Supabase database runs at port54322. Advisor checks remain a rollout gate for an actual environment.
