# Cached outbound ML prediction ownership

`predictDemand` and `predictPrice` in the Node API retain their existing
100-entry, fifteen-minute completed-result caches. Previously simultaneous cold
misses each started a provider call, even for identical inputs. The completed
cache bound did not limit active provider work.

## Native owner lifetime

Both functions now share an `OwnedPredictionFlights` instance with eight active
native slots. Its key captures the endpoint, request headers and existing cache
key before deferred dispatch. Same-key callers join one operation; distinct keys
at capacity reject with the existing promise/error contract. Cache hits still
bypass native admission and preserve existing cache identity/expiry behavior.

Ownership covers fetch, response-body parsing, existing validation and cache
publication. A five-second timer aborts the transport signal and rejects callers.
It does not free the native slot. The slot is released only when the underlying
operation settles; same-key callers joining an already expired owner reject
immediately until that settlement. An abort-ignoring transport/body cannot grow
native work beyond the owner bound. Late rejections remain observed after caller
timeout, and abort checks prevent deadline-expired work from publishing to caches.

Successful shared results preserve price validation, traffic multiplier, bands,
paisa conversion and demand response behavior. Failed HTTP/body/JSON/validation
results are not cached and release ownership after settlement, permitting retry.
No circuit breaker, pricing fallback or authentication policy is introduced.
Matching-only gateway PR16930 and price-band validation PR16924 remain separate;
this PR changes neither matching nor the validator.

## Verification

From repository root:

```sh
npm ci --prefix tools/prediction-ownership-tests --ignore-scripts --no-audit --no-fund
bash tools/prediction-ownership-tests/run.sh
```

The locked focused harness copies actual service/cache/validator/owner source to
a temporary workspace and mocks only logging/provider boundaries. It bypasses
the unrelated repository-wide dependency conflicts without changing production
package resolution. Fifteen new service-level cases plus three existing response
error cases pass: shared price/demand misses, pending bodies, shared capacity,
timeout/native retention, late-publication fencing, failure/retry, configured
endpoint separation, payload capture, cache TTL/capacity and existing key guard.
Eight new regressions fail unchanged main using `PREDICTION_SERVICE_SOURCE` with
the original service file. No live provider or credentials are needed.

## Limits

The pool is process local and only covers cached price/demand predictions. It does
not cap other ML/training endpoints or implement a queue. JavaScript timers require
a responsive event loop; this is not an absolute CPU/native execution deadline.
An abort-ignoring operation retains its slot until actual settlement. Completed
cache identities and mutable-result sharing retain existing behavior. Full API
suite, deployed transport behavior and live FastAPI integration are outside the
focused gate. CI uses Node22; local verification used Node24.
