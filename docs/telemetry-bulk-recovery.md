# Unordered telemetry bulk recovery

The actual MongoDB Node driver can put different per-record failures in one MongoBulkWriteError. The top-level code is not a whole-batch disposition. For example validation121 and retryable91 can coexist; dropping all writeErrors loses a valid record that should retry.

The pipeline now reads indexed errors from the wrapper or native BulkWriteResult (write-concern/network wrappers can have an empty writeErrors list). Require unique integer indices in the owned batch and integer error codes. Malformed metadata/getter errors retain all records. Only indexed code121 is classified as permanently invalid. Wrapper names, a top-level121 or message alone never establish permanent rejection.

Exclude non-error records from retries and count them flushed only if the unordered result is complete and consistent: ok1, insertedCount equals batch length minus unique indexed errors, insertedIds covers exactly the non-error indices, and no write-concern uncertainty is present. Otherwise retain uncertain non-validation records. There is no per-record success inference from generated IDs alone: interrupted native batches may expose generated IDs for records whose writes were never acknowledged.

Retry records are prepended oldest-first ahead of concurrent arrivals. Existing capacity/backoff and coalesced-flush behavior remain. Only actual capacity overflow contributes to overflowDropped; confirmed validation loss now has a separate validationDropped counter, also included in eventsDropped. Successful complete partial outcomes add only acknowledged records to eventsFlushed. A retryable/uncertain subset advances retryCount/backoff; an empty retry subset resets backoff/error state.

## Limits

Uncertain writes may already have committed. Conservative retry can produce duplicate-key failures or duplicates, depending on IDs/indexes; this does not implement exactly-once persistence, durable idempotency, rollback or cancellation. Codes other than121 remain retryable/uncertain here; duplicate-key or permanent custom-schema failures may continue retrying under the bounded ring and need operational diagnosis. Recovery of an ambiguous result deliberately favors retaining records over inventing acknowledgement. The existing shutdown protocol is unchanged by this PR; terminal drain/checkpoint ownership is addressed separately in#17053. No deployed database, schema or provider changes.

## Verification

```
npm ci --prefix tools/telemetry-bulk-tests --ignore-scripts
bash tools/telemetry-bulk-tests/run.sh
```

Twenty-six tests exercise the actual pipeline. Four use native MongoDB7.4.0 against a scripted local wire peer: mixed validation/retryable response, validation-only success accounting, write-concern uncertainty and an interrupted split batch. The peer performs no storage/validation itself: it verifies native protocol/error/result handling, not a MongoDB engine or deployed replica set. Remaining tests control malformed metadata, ordinary retry, arrival ordering, coalescing and bounded overflow. Only logger/config import boundaries have explicit inert seams. The runner copies source unchanged and lints both production modules and test files.
