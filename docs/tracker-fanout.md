# Tracking fanout admission

All subscriber fanout in the live raw WebSocket tracker uses the same admission helper: local/distributed location updates and generic local/Redis milestone/ETA fanout. Each fanout sends at most once to a socket even if it appears under both location routing keys. Normal payload serialization and target authorization are preserved.

`TRACKER_MAX_BUFFERED_BYTES` defaults to1048576 (1MiB). Positive finite values are floored with minimum1 and maximum16777216 (16MiB); unset, invalid, infinite and nonpositive values use the default. A send is admitted only when current `bufferedAmount` plus UTF8 encoded payload bytes fits the limit. Payload byte size is computed once per fanout. This controls admission by the tracker; WebSocket framing/compression overhead, kernel queues, total concurrent connections and other control-frame sends are separate. No hard global process-memory bound is claimed.

Closed sockets are skipped. Over-budget or failed sockets are retired once and terminated so the normal close/disconnect cleanup can remove subscriptions and cached channels. A WeakSet prevents later attempts from sending to a retired socket while termination finishes; it creates no strong socket registry or pending retry buffer. Clients must reconnect and reestablish their authorized subscriptions; unacknowledged updates can be lost. No client UI or reconnect policy is changed.

Synchronous send exceptions and send-callback errors cannot interrupt healthy subscriber fanout. Location delivery metrics count admitted sends, not peer receipts: an asynchronous failure after admission cannot retroactively prove delivery or subtract a previously recorded admission. A callback that fails before send returns is not counted. No reliable/exactly-once/transactional delivery guarantee is introduced; Redis event-publishing decisions are unchanged.

## Verification

Run `npm ci --no-fund` in `tools/tracker-fanout-tests`, then from the repository root run `bash tools/tracker-fanout-tests/run.sh`.

The locked runner imports actual tracker and fanout modules unchanged, retains actual locationEventBus and real ws8.22.0, ioredis6.0.0 and jsonwebtoken9.0.3. Database, logger, GPS persistence, ETA integration, telemetry buffer and adaptive scheduler imports are mocked boundaries to keep focused tests independent of unrelated startup/provider dependencies. No authentication is bypassed and no deployed service is called.

27 new tests plus39 existing distributed location-bus tests pass locally with changed-file lint. Seven selected actual-main tracker fanout regressions fail before the fix (20 other new tests outside the baseline comparison). Two real loopback WebSocket tests cover exact frame delivery/oversized retirement and a paused reader reaching the actual queued-byte threshold; deterministic cases cover transport failures, healthy-subscriber progress, deduplication, UTF8 boundaries, invalid limits, callback errors and sustained blocked-reader attempts. GitHub uses Node22. This gate does not claim whole-monorepo CI or full production tracking/auth integration.
