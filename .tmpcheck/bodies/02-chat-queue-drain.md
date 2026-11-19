## Problem

`drainOfflineQueue()` in `backend/api/src/lib/messageQueue.js` reads a user's offline chat backlog with `LRANGE` and then deletes the same key with a separate `DEL`. The two commands are independently atomic, but the read-delete sequence is not. Two gateway workers or two reconnecting sockets for the same user can both observe the same backlog before either delete runs.

## Root cause

The queue drain is a read-modify-write operation spread across multiple Redis round trips. There is no lock, transaction, or compare-and-delete step, and messages appended after `LRANGE` but before `DEL` are removed without ever being delivered.

## Impact

- Every reconnecting client can receive the same backlog, causing duplicate chat messages and duplicate notifications.
- A message enqueued in the race window is silently lost even though the sender received a successful enqueue response.
- Reconnect storms after a gateway restart amplify both effects across every affected user.

## Proposed fix

- Replace the two commands with one Lua script that performs `LRANGE` and conditional `DEL` atomically on Redis.
- Parse each queued entry independently and discard corrupt entries instead of failing the whole drain.
- Keep the existing return shape so socket handlers do not need to change.

## Verification

- Exercise two concurrent drains against one backlog and assert that only one drain receives the messages.
- Append a message during the drain and assert it is not deleted without being returned.
- Include malformed JSON in the queue and assert valid messages are still delivered.

Request: @Senthil455 please assign this issue.
