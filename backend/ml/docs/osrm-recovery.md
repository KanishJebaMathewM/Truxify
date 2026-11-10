# OSRM traffic dependency recovery

The traffic pipeline uses bounded HTTP timeouts and three attempts (backoff 1s,
then 2s) for ordinary requests. After `OSRM_CIRCUIT_THRESHOLD` exhausted requests
(default 5), it returns the existing degraded speed fallback without HTTP calls.
The retry budget is per request; ordinary concurrency remains governed by the
service's existing request admission limits.

After `OSRM_CIRCUIT_RECOVERY_SECONDS` (default 30), one caller probes OSRM with
one HTTP attempt. Other callers immediately receive fallback. Success closes
and resets the circuit; failure or cancellation restarts the cooldown. A valid
`NoRoute` response also proves availability, while preserving fallback for that
route. HTTP errors and malformed payloads do not count as successful recovery.

The cooldown uses monotonic time. Request generations prevent old in-flight
results from changing the state after an outage or recovery transition. The
circuit is local to a pipeline instance sharing one asyncio event loop; it is
not a distributed circuit or a synchronization mechanism across OS processes or
threads. No background timer or paid provider probe is introduced.

`TrafficPipeline.get_osrm_health()` exposes state, consecutive failures, remaining
cooldown and aggregate success/failure/rejection/cancelled-probe counters. It
contains no URLs, API keys, coordinates or route IDs and performs no HTTP call.
Metrics are process-local and reset on restart. This change does not add an
unauthenticated HTTP health endpoint, modify reference-speed calculations or
persist fallback data as model-training observations.

Run the recovery and existing traffic suites from `backend/ml`:

```sh
python -m pytest tests/test_recovery_circuit.py tests/test_osrm_circuit_recovery.py tests/test_traffic_pipeline.py tests/test_traffic_pipeline_route_windows.py -q
```
