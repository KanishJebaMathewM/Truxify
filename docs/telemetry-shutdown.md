# Telemetry drain and recovery

The shared Socket.IO/WebSocket telemetry buffer owns each bulk insert until its driver promise settles. Shutdown is terminal for that module instance and returns the same promise to concurrent and repeated callers. Stop producers before invoking shutdown. The scheduler stops immediately, start becomes a no-op, and external flush/batch triggers cannot dispatch another insert. Records arriving while the drain runs are still accepted into the bounded active ring; arrivals after shutdown returns are explicitly dropped and counted. A process restart creates a fresh pipeline and loads the recovery file through the existing startup path.

## Finite drain

The monotonic total budget is MONGODB_SHUTDOWN_WAIT_MS (default10,000ms) plus TELEMETRY_SHUTDOWN_FLUSH_TIMEOUT_MS (default10,000ms). Each accepts a finite number from0 through30,000; invalid values use the default. Mongo readiness uses only the readiness portion. Existing and subsequent final writes share the remaining total budget rather than receiving a fresh timeout. Zero flush budget checkpoints without dispatching a final insert. A transient error ends the drain after requeueing; it does not busy-loop retries during shutdown.

At expiry or failure, capture the in-flight owned batch followed by retry and active records. Write a unique temporary file with mode0600 and atomically rename it over RECOVERY_FILE_PATH. This prevents a partial write from destroying the previous complete checkpoint. If writing or replacing fails, preserve the older file and current memory and log the error. Synchronous filesystem work and event-loop scheduling can exceed the timer budget; this is a bound on asynchronous database waiting, not a hard wall-clock or power-loss durability guarantee. Recovery contents remain bounded by the existing active-ring and in-flight batch capacities; normal overflow policy and metrics remain in place.

Late driver completion is observed by the original flush and may update memory/metrics, but never removes or changes the shutdown checkpoint. An uncertain Mongo write can already have committed or commit after the checkpoint is written. Replaying that snapshot can therefore produce duplicates. This protocol provides an at-least-once recovery opportunity, not exactly-once persistence, database cancellation, rollback, or protection against process termination before the checkpoint. Use a private recovery path per process and durable storage if recovery must survive container replacement; multiple processes sharing a path remain unsupported. Existing validation/partial-bulk classification behavior is outside this fix.

## Verification

```
npm ci --prefix tools/telemetry-shutdown-tests --ignore-scripts
bash tools/telemetry-shutdown-tests/run.sh
```

The runner copies the unchanged selected production module and actual tests into an isolated tree. Only logger and database import boundaries receive inert seams; tests provide controlled insert outcomes. Real temporary files cover checkpoint replacement, permissions, failure preservation and fresh-instance recovery. Deterministic timers exercise drain interleavings; one fresh Node subprocess verifies a never-settling owned write with native timers. No Mongo server, deployed configuration or full-stack verification is claimed.
