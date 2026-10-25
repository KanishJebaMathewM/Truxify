# Stale-order sweep ownership

The mounted worker uses a unique random token for each sweep's120-second Redis lease. SET NX must return `OK`. Renewal and release run atomic Lua comparisons; an expired worker cannot renew or delete a successor's key. The current worker regressed from9401/9493 to unconditional EXPIRE/DEL; an actual-module fixture replaced the key during candidate fetch and observed ten renewals, ten later cancellation calls and successor deletion.

## Admission and draining

Renew every40 seconds during slow fetch/work and before admitting each cancellation. Concurrent renewal requests share one promise. A monotonic deadline starts before sending acquisition/renewal, giving conservative local admission accounting. A missing key, ownership mismatch, Redis error or locally expired lease irreversibly closes admission for that sweep; delayed positive replies cannot revive it. Never reacquire within the same run.

At most five cancellation calls run at once. Configured batch size accepts finite values>=1, floors fractional values and caps at1000; invalid values use100. A defensive slice applies the same cap to candidate responses. Already-admitted operations drain before the local guard is cleared. Cleanup stops the heartbeat, drains pending renewal and compares the token before release. A release failure is logged and does not leave the local guard stuck. No Redis configured preserves the existing process-local-only behavior, with no cross-replica guarantee.

## Limits

Redis cannot cancel or fence an already-started database/notification/provider operation. A process pause or lost lease can overlap another replica's in-flight work. The existing `cancel_stale_order_tx` database CAS remains the winner authority; a lost CAS or returned DB error causes no downstream effect. A cancellation already won continues its existing load-offer/refund/notification path even after later lease loss. This change does not introduce exactly-once side effects, transactional notification/refund delivery or a business generation fence.

Redis request settlement depends on the configured client's timeouts; no new transport deadline is added. A hung pending operation can delay draining. No live schema, provider, payment or deployment is performed. The obsolete acquireLock/renewLock/releaseLock exports named in9401 are absent from current redisLock.js; this worker uses private scripts without changing that utility's other callers.

## Verification

Run `npm ci --prefix tools/stale-sweep-tests --ignore-scripts`, then `bash tools/stale-sweep-tests/run.sh`; set `REDIS_SERVER_BIN` if needed. The isolated harness copies the actual worker unchanged and controls only external imports. Existing scheduling/race/notification/concurrency suites run with updated token-aware Redis fixtures. New tests cover monotonic expiry, late replies, slow-fetch heartbeats, successor replacement, five-way admission, draining, separate module replicas, missing Redis, errors and bounded configuration. Native Redis runs only on an isolated temporary Unix socket with persistence disabled; actual captured Lua is tested for matching/nonmatching/expired tokens, successor TTL preservation and owner cleanup. The runner explicitly enables `STALE_NATIVE_REDIS=1`; ordinary unit discovery skips those four native integration cases when that flag is absent. Focused Linux CI installs Redis and runs all44 cases without skips on Node22. No whole repository or real business integration pass is claimed.
