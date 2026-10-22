# Federated update admission and acknowledgement

Both the server's Pub/Sub callback and `drain_pending_client_updates` deliver
`federated:update:{client_id}` through the same process-local round owner.
Notifications are hints; the encrypted inbox bytes supply the actual round/model.

## Protocol

1. Under the existing reentrant round lock, check that the client is selected.
2. Read the pending bytes with GET. Do not delete them or extend their TTL.
3. Run the existing native envelope/model admission and confirmed round publication.
4. On success (including a validated current-round duplicate), acknowledge with one
   Redis Lua compare-and-delete of those exact encrypted bytes.
5. On a failed read or admission, leave the inbox unchanged. On an acknowledgement
   error, retain the native acceptance result; a subsequent poll can acknowledge
   the deduplicated contribution. An uncertain native receipt is reconciled by the
   existing server recovery protocol before acknowledging it.

A replacement envelope written during handling survives the conditional delete,
even when the acknowledgement response is lost. There is no separate GET/DEL or
GETDEL fallback. Redis EVAL permissions are required for acknowledgement, in
addition to permissions already needed by confirmed native round publication.
The old `atomic_getdel` utility remains for compatibility but neither server
inbox reader uses it.

Valid current-round duplicate envelopes remain acknowledgeable after completion;
round tags, encryption and selected-client checks still precede deduplication.
Stale/future envelopes are retained rather than being accidentally acknowledged
as a previous contribution. Legacy list-envelope interpretation is unchanged.

Polling counts newly admitted contributions, not acknowledgements or duplicate
cleanups. Already-admitted clients are revisited so a failed acknowledgement can
be retried. Polling owns its selected-client iteration through admission and ack;
a concurrent process-local round start waits for that operation to finish.

## Limits

This does not introduce a retry scheduler. Pub/Sub is still a lossy hint and
operators/callers use the existing polling entry point after an outage. Failed or
malformed inbox payloads remain until replaced or their existing one-hour TTL
expires; repeated polling can retry them. No quarantine or automatic deletion is
introduced. A failed acknowledgement can retain an already-accepted payload.

This is not a Redis persistence/replication guarantee, exactly-once computation
after process loss, multi-coordinator scheduling/election, client restart/resend
protocol, retained history of every submission, or Pub/Sub stop/start redesign.
Independent writers can still overwrite the single client inbox. Confirmed server
receipts, native model admission, client training/round ownership, DP/median math,
key rotation and existing routes are preserved. No provider, sensor, vehicle or
production Redis is used by verification.

## Native verification

The focused workflow uses real TensorFlow/Keras, Fernet and isolated native Redis
Unix sockets on Linux. Tests execute actual GET/EVAL commands before controlled
response loss, use Redis ACLs to refuse snapshot writes, preserve replacement
bytes, reconcile uncertain receipts, and exercise a real Pub/Sub worker alongside
polling. TensorFlow model, candidate math, Redis commands and encryption are not
replaced with fake implementations. Two existing protobuf deprecation warnings
are tracked separately from the test result.

```sh
REDIS_SERVER=redis-server PYTHONPATH=backend/ml python -m pytest \
  backend/ml/tests/test_federated_update_delivery.py \
  backend/ml/tests/test_federated_round_recovery.py \
  backend/ml/tests/test_federated_model_admission.py \
  backend/ml/tests/test_federated.py \
  backend/ml/tests/test_federated_client_round_protocol.py -q
```
