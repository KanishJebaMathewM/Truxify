## Problem

`getStatementPayout()` in `backend/api/src/services/driver/statementPayout.js` returns any finite numeric amount, including negative values. Negative legacy amounts, reversed adjustments, or corrupt imported rows can therefore be presented as the driver's payout and passed to wallet or statement code as a debit.

## Root cause

The function validates that the selected payout field is finite, but not that it represents a payable amount. It also reconstructs a legacy total from fields that can individually be negative, so the fallback can produce a negative result even when the primary fields are absent.

## Impact

- A negative payout can be written to statements or wallet operations as a charge against the driver.
- Legacy or corrupt order rows produce a misleading financial statement instead of a safe zero or a review flag.
- The function is the shared payout calculation, so the error propagates to every statement consumer.

## Proposed fix

- Clamp the normalized finite amount to zero with `Math.max(0, amount)`.
- Keep the existing precedence: bid amount, total amount, then reconstructed legacy total.
- Return zero for non-finite values as before.

## Verification

- Test negative bid amounts, negative totals, and a legacy total whose components sum below zero; assert every result is zero.
- Test valid positive amounts and the precedence order.
- Run the statement payout unit tests.

Request: @Senthil455 please assign this issue.
