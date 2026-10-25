# Bounded federated HTTP jobs

Every mounted federated handler runs its complete synchronous operation through
`app.execution.run_inference`. Redis I/O, model/client construction, synthetic
observations, native training, publication and inbox polling run on a native
worker, leaving the request loop available. The existing shared executor bounds
active work and waiters across event loops; its configured response deadline
still applies (30 seconds by default). Overload is503 and a response deadline504.

A process-local native owner covers each complete federated HTTP operation.
A concurrent federated worker fails with503 rather than waiting behind the owner
and creating a second job/client. Cached lookup/construction uses the same
reentrant owner; at most64 clients are cached. Reusing a cached ID remains allowed
at capacity. A new ID at capacity returns503 and never silently evicts a live
subscriber. This cache policy does not prune registrations in Redis.

## Cancellation and state

The native callable owns the operation lock. The existing execution future owns
its capacity until it actually finishes. Cancellation/disconnect or response
expiry does not release either while an admitted native operation still runs.
Python cannot forcibly stop arbitrary native fitting; a job can finish fitting,
publish and confirm its update after the HTTP waiter has gone. A permanently
stuck native job retains its owner/capacity rather than allowing overlapping work.
This boundary does not promise transactional rollback after cancellation.

The native server/client round locks and complete-fit/optimizer admission remain
in force. HTTP participation success retains its existing publication meaning;
a separate Pub/Sub consumer can confirm the server contribution asynchronously.
It is not a claim that a full quorum has completed before the response.

## Request policy

Counts are strict JSON integers: epochs1..16 and rounds1..64. Client IDs are strict
strings of1..256UTF-8 bytes. Rejected requests fail422 before worker dispatch,
client construction or synthetic data allocation.

`/client/train` admits at most64 total round-epochs (`rounds * epochs`), preserving
the default10×5 job. Participation executes one round and does not multiply its
actual work by an unused default rounds value. The existing local-fitting row,
parameter-work, finite observation and optimizer policies still apply. These are
explicit resource policies, not universal runtime or memory guarantees. Deliberate
HTTP statuses pass through rather than being converted to generic500 responses.

Synthetic driver generation uses its own NumPy `RandomState` with the original
clock/client seed formula. Frozen serial arrays and labels are identical, while
concurrent generators leave unrelated process NumPy streams untouched. This does
not isolate all stochastic TensorFlow/native-library state or redefine DP noise.

## Scope

This is process-local mounted HTTP ownership, not distributed scheduling,
shutdown/client-subscription lifecycle redesign, arbitrary direct-caller
synchronization, provider integration, accelerator validation or physical model
quality. Existing response shapes, model/round pairing, duplicate publication,
confirmed server receipts, inbox transport, key rotation and DP/median math are
preserved. No production Redis, camera, sensor or vehicle is used by tests.

The focused workflow executes actual ASGI requests, Keras fitting, Fernet and
private native Redis. Entry gates wrap and then invoke the original native fit;
models, encryption, Redis operations and numerical references are not faked.
Cancellation/deadline tests observe native completion before releasing resources.
