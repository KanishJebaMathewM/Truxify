## Problem

`drainOfflineQueue()` in `backend/api/src/lib/messageQueue.js` reads a user's offline chat backlog with `LRANGE` and then deletes the same key with a separate `DEL`. The two commands are independently atomic, but the read-delete sequence is not. Two gateway workers or two reconnecting sockets for the same user can both observe the same backlog before either delete runs.

## Change

- Replace the two commands with one Lua script that performs `LRANGE` and conditional `DEL` atomically on Redis.
- Parse each queued entry independently and discard corrupt entries instead of failing the whole drain.
- Keep the existing return shape so socket handlers do not need to change.

## Verification

- Exercise two concurrent drains against one backlog and assert that only one drain receives the messages.
- Append a message during the drain and assert it is not deleted without being returned.
- Include malformed JSON in the queue and assert valid messages are still delivered.

Closes #19437
