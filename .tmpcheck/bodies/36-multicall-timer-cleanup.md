## Problem

`multicall3Service` in `backend/api/src/services/blockchain/multicall3Service.js` creates a timeout promise with `setTimeout` for every batch but never clears the timer when the batch succeeds. Each successful call leaves a live 30-second handle, keeping Node or test workers open and accumulating handles in long-running processes.

## Root cause

The timeout is raced against the RPC promise, and the winning path returns without a `finally` branch that clears the losing timer. The service also accepts a non-array `calls` value and fails later with an unclear error.

## Impact

- Long-running API workers accumulate timer handles and unnecessary wakeups.
- Test processes hang until every timeout expires, slowing CI and masking shutdown bugs.
- Invalid input reaches the encoder and produces an indirect TypeError.

## Proposed fix

- Validate that `calls` is an array before starting the batch.
- Keep the timeout handle and clear it in a `finally` block on both success and failure.
- Call `unref()` on the timer so it never keeps the process alive by itself.

## Verification

- Assert the timer handle is cleared after a successful batch and after a timeout/rejection.
- Test a non-array `calls` value and assert a clear TypeError.
- Run the multicall service tests.

Request: @Senthil455 please assign this issue.
