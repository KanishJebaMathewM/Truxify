# Telemetry Ingestion Concurrency Architecture

## Atomic Admission Control
The previous implementation used a "check-then-act" pattern for active driver capacity:
1. Read map size
2. If size < max, insert
This allowed multiple concurrent requests to pass the check simultaneously, violating the capacity cap.

**Fix:** Replaced with `reserveActiveDriver()` using `atomic.CompareAndSwapUint64`. This guarantees that exactly one goroutine wins the slot reservation before inserting into the `sync.Map`.

## Safe Rate-Limit Eviction
Rate limit entries are no longer blindly deleted when the map exceeds `maxRateTracked`. 
Instead, entries maintain an `inUse` reference counter. 
- `acquireRateEntry()` increments `inUse` under a mutex.
- `evictGeofenceOverflow()` skips any entry where `inUse > 0`.
- `endUse()` decrements the counter when the request completes.

This ensures that an in-flight request's sliding window timestamps are never orphaned or reset mid-request, preserving strict rate limit enforcement even under heavy churn.

## Verification
Run the race detector to verify these guarantees:
```bash
go test -race -v ./...
```
