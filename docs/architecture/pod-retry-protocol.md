# Persisted driver POD retry protocol

The `pods_cache.db` queue owns both capture-screen and Workmanager uploads.
It is separate from the legacy trip-stop `LocalDbService` queue; this change does
not migrate that queue or claim exactly-once delivery.

## Ownership and recovery

Schema v3 preserves v1 POD rows and v2 indexes, adding attempt, due time, error,
lease, generation and stable upload identity fields. A transaction admits one due
row; new rows precede retries. Admission increments its attempt/generation and
holds a two-minute lease. Every acknowledgment/failure checks the generation and
unexpired lease. An expired worker cannot mark a later claim successful. SQLite
BUSY/LOCKED admission retries yield outside the transaction for at most 30 ms;
continued contention defers admission without consuming an attempt.

A process killed during upload leaves a lease which can be reclaimed after
expiry. An expired tenth attempt moves to the separate `pod_dead_letters` table.
Failure transitions and dead-letter insertion are atomic. Manual review resets
attempts, increments the generation and preserves the upload key. Do not reuse a
POD row ID via replacement to bypass this protocol.

## Retry policy and credentials

Failure delays are 1 min, 5 min, 30 min, 2 h, 6 h, 24 h, with 24 h for subsequent failures.
Ten admitted attempts exhaust a document. No available credentials means no
admission. A 401 can refresh once; a repeated 401 pauses the batch and restores
the document attempt count. A 403 is a document-specific failure: it follows
backoff and the ten-attempt dead-letter budget without stopping other PODs. Errors persist only status/type, never response
bodies or credentials. Provider token resolution is bounded to 10 s; each owned
native HTTP client has a 30 s total preparation/send/body deadline and is closed
on completion/error/timeout. Missing required attachments fail the document;
they are not silently omitted. Configured upload URLs must use HTTPS; only debug
builds allow HTTP at localhost, 127.0.0.1 or [::1]. Invalid URLs pause sync before
credential lookup/admission, keeping saved deliveries pending.

A persisted random 128-bit key is sent as `X-Idempotency-Key`, compatible with the
existing POD middleware. This helps server replay handling, but its retention
window and provider side effects still limit deduplication. A successful upload
whose local acknowledgment is interrupted can be retried: delivery is at least
once, not exactly once.

## Scheduling and visibility

Workmanager registers a connected periodic task at 15 min. Connectivity bursts
have a 30 s trailing debounce; going offline cancels it. Foreground capture uses
this same queue, and app resume refreshes it. Capture returns after local save
and starts sync without waiting for a batch; its confirmation reports a saved
background upload, never an unobserved upload success. Batches admit at most 20 jobs and
stop admitting after two minutes; a current bounded upload can finish after
that admission budget. OS background scheduling is best effort, so persisted
backoff times are earliest eligibility, not promised upload times. Native
Workmanager capabilities/entitlements still need the platform's normal setup;
no device background-delivery or full application build is claimed by the tests.

Local metrics expose pending, retrying, dead-letter counts and last success.
The foreground banner provides persistent stuck-work visibility and manual
review/requeue; background isolates do not call UI notification channels.

## Verification

With Flutter 3.47.5 installed, run from the repository root:

```sh
bash tools/driver-pod-tests/run.sh
```

The locked isolated package copies the real storage, runner, HTTP transport,
background adapter, capture screen and notification widget, with their focused tests. It runs
analysis and real SQLite FFI/native HTTP tests, plus scheduling/widget tests.
It deliberately does not claim the entire driver application passes analysis.
Main's unrelated unquoted WebRTC dependency range is handled by own PR #16874.
This protocol incorporates and supersedes own PR #16759's v2 migration/index tests;
only one active proposal should remain for that overlapping work.

Persisted times use the device wall clock. Clock changes can delay eligibility
or expire a lease early; stable server replay identity mitigates duplicate
submission but cannot guarantee server deduplication beyond its cache window.
