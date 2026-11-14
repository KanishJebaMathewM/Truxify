# Atomic cold-chain Redis windows

The mounted `/api/iot` telemetry route calls `coldChainAnomalyService.processTelemetry`. Ingestion and the MKT snapshot now execute in a single, static Redis Lua script: RPUSH → LTRIM → EXPIRE → LRANGE. Redis serializes scripts against other commands, so concurrent service callers cannot observe partially appended batches. The returned snapshot belongs to the same ordered operation that ingested that caller's readings.

The service sends at most the last 120 valid readings, because earlier readings from that batch cannot survive the existing 120-entry window. This bounds each Redis invocation's input and four internal commands independently of batch size. Each sample retains the existing `{t, timestamp}` JSON format, the key stays `coldchain:window:<loadId>`, and successful ingestion refreshes the existing 86,400-second expiry. Timestamping still reflects application ingestion time, not sensor time. The live HTTP route supplies one reading; the service's batch API is also supported.

Redis errors reject EVAL and enter the existing warning/local fallback. This fallback evaluates the **full** valid input batch, as it did for thrown errors before this change. Consequently fallback evaluation can exceed 120 readings and does not recover historical Redis samples. Filtering/serialization of the original batch remains proportional to its size; this is a Redis work bound, not a bound on total input processing.

Scripts provide isolation, not rollback. RPUSH is deliberately first: WRONGTYPE raises before any trim/expiry change. Later command errors, ACL changes, memory errors or connection loss after execution can still leave mutations applied; this change does not add exactly-once delivery, rollback, retry, command deadlines or distributed alert deduplication. Redis must permit EVAL and the four underlying commands. The script uses one declared key, so no cross-slot operation is introduced. Redis blocks other commands during the script; the submitted suffix is bounded but trimming a pre-existing oversized list can still require work proportional to that old list.

MKT arithmetic, five-sample consecutive excursion detection, cumulative MKT thresholds, notifications, audit logging and escrow mitigation remain unchanged. Malformed/non-numeric retained JSON is excluded as before. Existing numeric coercion remains unchanged.

## Verification

Install Node.js >=20.19 and a local `redis-server` executable (or set `REDIS_SERVER_BIN` to its absolute path). From the repository root:

```bash
npm ci --prefix tools/cold-chain-window-tests --ignore-scripts
bash tools/cold-chain-window-tests/run.sh
```

The harness executes the actual service and performance wrapper. Database, logging and notification imports are isolated; no database, production Redis, provider or notification connections are used. Tests start their own Redis process with a private Unix socket, no TCP listener and persistence disabled, and terminate it after the suite. Real native-client tests cover four-client concurrent batches, exact retained order, a 1,000-reading input, expiry, WRONGTYPE errors, malformed history, load isolation and unchanged breach thresholds. Locally verified with Redis 7.4.11; CI installs the Ubuntu Redis package and runs the same suite.

The original service fails the bounded-command, real concurrent oversized-batch and WRONGTYPE fallback regressions. A source override can repeat the comparison without altering the worktree:

```bash
COLD_CHAIN_SERVICE_SOURCE=/absolute/path/to/baseline/coldChainAnomalyService.js bash tools/cold-chain-window-tests/run.sh
```

Atomic execution semantics: https://redis.io/docs/latest/develop/programmability/eval-intro/
