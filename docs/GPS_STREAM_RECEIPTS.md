# GPS stream ingestion receipts

`GpsStreamIngestionService` owns a finite, bounded, copied observation before filtering,
geofence evaluation or Redis work. IDs are nonblank strings up to 256 characters or
nonnegative safe integers (including zero). Coordinates are finite geographic numbers;
speed is 0–10000 m/s, heading 0–360 degrees, accuracy 0–1000000 metres, and timestamps
are nonnegative integer epoch milliseconds representable by native Date. These are
admission limits, not calibrated vehicle safety policies.

`success` and `persisted` mean that XADD returned a stream ID. `streamId` is null when
unacknowledged; `deliveryReason` distinguishes `acknowledged`, `redis_unavailable`,
`invalid_acknowledgement` and `acknowledgement_pending`. A failed receipt still contains
its local `smoothed`, `geofenceEvents`, ISO `timestamp`, and exact owned `observation`.
Retry by submitting `receipt.observation`, particularly when the original timestamp
was omitted. The same admitted observation does not re-run filter or fence transitions.

One latest receipt is retained per trip. While it is unacknowledged, a different
observation is rejected; identical calls share the admitted write. A call waits at most
`acknowledgementTimeoutMs` (default 10000, range 1–60000). The underlying Redis command
is NOT cancelled at that deadline: it stays owned until it settles. Late acknowledgement
updates the retained receipt. Calls cannot discard/retry a still-running command.
A client whose command never settles holds that trip until the client settles it; configure
native client transport/command deadlines as appropriate. The service does not override
shared Redis client policy. Group initialization also bounds caller waiting and retains
its active command; BUSYGROUP means the group already exists.

After acknowledgement, exact duplicate replay of the latest observation returns the
same receipt without XADD. A different observation must have a strictly newer timestamp.
Older history is not deduplicated. Caller-mutated input/results cannot change the retained
payload. `kalmanFilters` now returns defensive observation snapshots, not mutable filters.
Stationary filter speed zero is written as zero instead of being replaced by raw speed.

`maxTrips` defaults to 10000 (1–100000). `clearTrip(id)` removes completed/faulted local
tracking and its fence membership; it refuses to discard an unacknowledged receipt or
active write. Capacity rejects new trips instead of evicting live work. A collaborator
failure during a local filter/fence transition fences that trip until explicit cleanup;
collaborator mutations are not transactionally rolled back. Existing filter/evaluator
implementations remain separate, including their pending independent repairs.

XADD uses approximate MAXLEN retention (`maxStreamEntries`, default 100000, 1–10000000).
Approximate trimming can exceed the requested count and can remove data before consumers
process it: this is a bounded live telemetry stream, not a durable delivery queue.
Configure retention for workload/consumer lag. Group creation retains the existing `$`
start policy and does not replay earlier entries. No consumer processing acknowledgement
is implied by the producer's XADD acknowledgement.

Delivery is volatile and at least once. Ambiguous network errors can follow a successful
Redis write; a later retry can therefore duplicate an entry. A process restart loses
local receipts. No exactly-once, crash recovery, mounted HTTP producer, downstream SQL,
production Redis, or real sensor/vehicle control claim is made. Native tests run the
actual service/filter/evaluator and ioredis 6.0.0 against private Redis, exercising ACL
rejection, CLIENT PAUSE late acknowledgement, replay, stream contents and group responses.
Default application database initialization is lazy and excluded from injected-client tests.
