## Problem

`multicall3Service` in `backend/api/src/services/blockchain/multicall3Service.js` creates a timeout promise with `setTimeout` for every batch but never clears the timer when the batch succeeds. Each successful call leaves a live 30-second handle, keeping Node or test workers open and accumulating handles in long-running processes.

## Change

- Validate that `calls` is an array before starting the batch.
- Keep the timeout handle and clear it in a `finally` block on both success and failure.
- Call `unref()` on the timer so it never keeps the process alive by itself.

## Verification

- Assert the timer handle is cleared after a successful batch and after a timeout/rejection.
- Test a non-array `calls` value and assert a clear TypeError.
- Run the multicall service tests.

Closes #19471
