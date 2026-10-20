# Matching dependency admission

The Node API's `matchDeadhead` operation uses a dedicated `MlMatchingGateway`.
Pricing, demand, ETA, administration and the separate shared `CircuitBreaker`
retain their existing policies. This addresses the remaining matching outage
portion of issue3440; the historical example paths no longer describe the tree.

## Bounds and recovery

- At most eight matching operations are admitted per API process. There is no
  waiting queue; excess requests immediately reach existing caller fallback.
- A2500ms deadline covers fetch headers, body consumption and response validation.
  Expiry aborts the native fetch and rejects the caller. Event-loop scheduling,
  database work and synchronous ranking can add time; this is not an end-to-end
  three-second booking SLA.
- Five consecutive dependency failures open the circuit for30seconds. Healthy
  responses reset the consecutive count. Admission rejection is not a dependency
  failure. Missing ML_API_KEY is checked before admission.
- Cooldown uses a monotonic clock. After cooldown exactly one recovery probe is
  admitted; concurrent callers fall back. Probe failure restarts the cooldown;
  success closes the circuit. Transition logs include state and live occupancy.
- Each admission captures the circuit generation. Pre-outage completions cannot
  close a newer open circuit or reopen a recovered one.
- A timed-out operation retains its capacity until its underlying promise settles.
  Native fetch honors abort, including body reads. An adapter ignoring abort can
  permanently occupy a slot; after eight such operations this process denies all
  new matching work. It does not release phantom capacity and accumulate unbounded
  work. This bound is local to a process, not distributed across replicas.

## Caller behavior

Healthy matching responses preserve their shape but must contain an array of
recommendations. Invalid JSON/schema, network and HTTP errors enter the same
failure path. Errors carry an `[ML]` marker and a cause; the actual direct deadhead
route maps unavailable inference to its existing503 response instead of treating
native connection errors as an unexpected500.

`matchEnRouteLoads` retains its existing Haversine distance ranking on unavailable
inference and on a healthy empty recommendation response. Both now report
`ml_used:false`. Nonempty ML predictions report `ml_used:true`.
The fallback is a distance heuristic: this change does not establish cargo safety,
road-based deadlines or guaranteed profitability. No synthetic learned confidence
is added. Authentication, validation and policy middleware stay in place.

The deployed `backend/ml/main.py` already exposes unauthenticated `/health` with
healthy/degraded status, model artifact checks and a count of loaded models.
It is not replaced by a constant `models_loaded:true`, and no new readiness poll
is added to every inference request. This PR does not implement the original
issue's proposed universal ML circuit or claim its entire historical checklist.

## Verification

Focused suites: `mlMatchingGateway`, `mlMatchingOutage`, `mlEnRouteFallback`,
`mlEnRoutePaisa`, `ml` and `mlService` under backend/api/test/unit. New tests include
bounded admission, abort-ignoring capacity retention, stale completion fencing,
25 concurrent probe requests, real local HTTP body cancellation and actual
service-to-route503 mapping. Unrelated auth startup is mocked for that handler
integration; the matching service and route handler are actual production modules.
No paid provider, live deployment or model training is involved.
