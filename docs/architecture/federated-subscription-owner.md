# Federated native subscription ownership

Each client/server instance owns one Redis subscription generation. Repeated or
concurrent starts return true for its existing active listener. The native
listener uses redis-py's `get_message` with a 50ms read timeout, a separate
retirement Event, and a finally-owned PubSub close. This avoids redis-py's
worker startup/stop flag race and closing the socket under a running parser.

`stop_subscription(timeout=1.0)` and `stop_update_consumer(timeout=1.0)` retire
callback admission and join the captured worker for up to the supplied 0–30
second budget. True means that generation exited. False means its admitted
callback/read still owns the native resource; public handles remain available,
and a new start refuses replacement until actual exit. A subsequent stop/start
reaps a dead generation. A callback stopping itself returns false without trying
to join itself. A stale saved handler is fenced by generation identity and
retirement, including after restart. The timeout is a join budget, not a hard
wall-clock guarantee for OS scheduling or resource close.

Already admitted callbacks may finish and mutate their ordinary round state.
Stopping is not rollback or native thread cancellation. An inactive callback
cannot be admitted, but one admitted just before retirement may enter its body
after retirement; successful drain waits for it. No generation lock is held
while joining, and no model/round lock is acquired by the lifecycle owner.
Callers holding a lock needed by a callback can receive false at the deadline;
they must release it and drain again before destroying shared Redis resources.

Subscription establishment still uses the supplied Redis connection policy.
There is no new network establishment deadline, reconnect scheduler, reliable
PubSub delivery, distributed election, process-loss recovery, or application
shutdown orchestration. Fatal reader failures are logged and release the
connection; a later explicit start may replace a dead listener. No model math,
round protocol, queue acknowledgement, key rotation or HTTP job protocol changes.
The legacy `pubsub`, `_sub_thread` and `_consumer_thread` read handles remain
available as properties; direct assignment to these implementation fields is
unsupported. Legacy polling stays independent.

Verification uses native Redis over private Unix sockets, concurrent starts,
blocked/admitted callbacks, timeout/restart and stale-generation controls,
self-stop, actual ACL denial, controlled post-SUBSCRIBE failure and full native
TensorFlow client/server integration plus existing round/recovery/model suites.
Only callback/failure boundaries are controlled; Redis, parsers, sockets,
threads, encryption and model implementations are real.
