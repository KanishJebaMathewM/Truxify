# Shared WebSocket connection ownership

The shared Dart transport is used by driver location reporting and customer
tracking. Awaiting a handshake through mutable global connection fields lets a
late attempt attach to or erase another attempt's channel. Cancelling a heartbeat
before that await completes also lets the continuation restart it after close.

## Attempt ownership

Each attempt captures its own channel, subscription, cancellation signal, and
monotonically increasing generation. Explicit connect, scheduled retry, and
permanent close invalidate the preceding generation. Ready, data, error, done,
heartbeat, and replay continuations check that they still own the current attempt.
A burst of explicit connects before admission creates only the surviving attempt.

Resources are detached synchronously before asynchronous cleanup. An old cleanup
can close only its captured channel and subscription; it cannot null a newer
transport. Failed handshakes are observed through both ready and the stream.
Cancellation ends the wrapper's ready wait immediately and cancels its deadline.

`close()` is permanent, cancels wrapper timers, discards pending replay, and rejects
later sends/connects. Recovering an exhausted `failed` attempt through `reconnect()`
is still supported until close. Screen disposal already treats close as terminal.
Transport cleanup actions run concurrently with a default one-second bounded wait.
Paused subscriber done delivery does not delay transport shutdown.

The third-party channel does not expose a portable abort of an in-progress TCP/TLS
upgrade. Closing its sink requests closure; a late successful loopback upgrade is
closed without callbacks or reconnection. A bounded cleanup wait is not a guarantee
that the underlying OS handshake has already finished. No change to authentication,
browser visibility handling, heartbeat pong protocol, or server reconciliation is
included. The disconnected replay queue retains its existing unbounded policy;
this change discards it at permanent shutdown, not a general byte-budget policy.

## Verification

`bash tools/shared-websocket-tests/run.sh` creates a fresh temporary package from
the actual shared module and its tests, with a committed dependency lock, clean
analysis, and test execution. The narrow barrel avoids unrelated Firebase/UI
initialization and is not a claim of full-app validation.

Existing twenty tests cover state, send return shapes, terminal-error visibility,
recovery, FIFO replay, and real local transports. New controlled-transport and
virtual-clock tests cover close before ready, replacement before ready, delayed
cleanup, failed-ready recovery, timer reclamation, write failure/replay, callback
reentrancy, paused subscribers, a hundred overlapping connects, and a real delayed
loopback upgrade. On unchanged main, analyzer reports seven instance-reference
initializer errors; after only making that controller lazy in a temporary harness,
the real delayed upgrade reproduces onConnect and connected state after close.
