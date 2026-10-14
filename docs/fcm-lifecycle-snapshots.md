# Applying FCM delivery outcomes

A provider response belongs to the device ID and token captured before sending.
Refreshing a token while Firebase is pending must not let an old rejection
retire the new registration or an old success refresh its last-seen timestamp.

`sendFcmNotification` builds success/invalid outcome records for each multicast
chunk (at most 500 distinct tokens). One `apply_fcm_lifecycle_outcomes` RPC applies
that batch. Conditional PostgreSQL updates match the user, device ID, current
FCM token and active state. Invalid outcomes deactivate matching rows first;
successes touch only still-active matching rows and do not move last_seen
backwards. Duplicate outcomes affect/count each device once. The profile fallback
is cleared only while its current token equals a rejected token. The RPC returns
actual affected-row counts rather than the size of an old snapshot. Retrying an
invalid outcome counts zero after the first deactivation.

The per-device `sendNotification` path uses the same guarded invalid-result
application. `clearInvalidToken(userId, token)` now retains a replacement profile
token; its existing tokenless explicit profile-clear mode remains available.
Provider categories, deduplication, partial delivery, multicast/retry limits,
message IDs and public result shapes remain unchanged. OTP operations are not
modified. The function is SECURITY INVOKER with an empty search path and execution
only for service_role; it changes no table policy or table grants.

## Failure and rollout limits

Apply `20261003034625_fcm_lifecycle_snapshot.sql` before deploying new backend
instances, refresh the PostgREST schema cache through the normal migration process,
and verify the RPC is visible to the existing backend service-role client.
Drain old instances: they still use ID-only lifecycle updates and can defeat this
protection. The migration is additive and reapplication preserves device records.
Rollback restores the old race; drain the fleet before reverting code.

If the RPC is missing, fails, or returns an invalid acknowledgement, log the
failure and report zero deactivations for that unacknowledged batch. Never fall
back to unsafe ID-only writes. Already-sent messages and successful provider
results are retained. A lost RPC response can leave a committed mutation whose
count is not acknowledged; the summary is not durable audit evidence. No provider
send is cancelled, rolled back, globally ordered or made exactly once.
Matching ID/token does not distinguish an identical-token re-registration (ABA)
or prove a provider's classification is correct. A token can change after a
conditional mutation commits. This is a persistence predicate, not a transaction
with Firebase, registration clients or future sends. Existing target-loading and
profile fallback policies remain unchanged.

## Verification

```sh
npm ci --prefix tools/fcm-lifecycle-tests --ignore-scripts --no-fund
bash tools/fcm-lifecycle-tests/run.sh
```

The locked runner copies the entire actual notification service unchanged and
executes service entry points against PGlite PostgreSQL tables/RPC. Firebase,
logging, OTP imports and measurement/config transport are controlled seams;
no external message or live database is used. Tests cover token/owner rotation,
late success, inactive rows, mixed delivery, provider categories, missing RPC,
duplicate rows, 501-token batching, fallback/legacy helpers, actual row counts,
invalid metadata, invoker privileges/RLS and migration reapplication. Fixtures
model canonical UUID IDs/token uniqueness and the needed lifecycle columns, not
the full migration chain. Tests are kept in the focused runner rather than adding
PGlite to the backend runtime or altering the broken pre-existing notification
unit suite. Dedicated CI uses the same Node22 runner; full monorepo CI is a
separate gate with existing failures.
