## Problem

`AlertRouter.sendToChannel()` in `backend/api/src/services/blockchain/alertRouter.js` resolves silently when the channel name is unknown. The caller uses `Promise.allSettled()` and treats every resolved promise as delivered, so a typo or removed integration marks the alert as sent while nothing was delivered.

## Change

- Throw an `Unknown alert channel` error from the default branch.
- Let the existing allSettled handling record the rejection and trigger the normal failure path.
- Update the test that expected silent resolution.

## Verification

- Call `sendToChannel('webhook', alert)` with no configured webhook channel and assert it rejects.
- Assert configured channels still resolve and deliver.
- Run the alert router tests.

Closes #19468
