## Problem

`getStatementPayout()` in `backend/api/src/services/driver/statementPayout.js` returns any finite numeric amount, including negative values. Negative legacy amounts, reversed adjustments, or corrupt imported rows can therefore be presented as the driver's payout and passed to wallet or statement code as a debit.

## Change

- Clamp the normalized finite amount to zero with `Math.max(0, amount)`.
- Keep the existing precedence: bid amount, total amount, then reconstructed legacy total.
- Return zero for non-finite values as before.

## Verification

- Test negative bid amounts, negative totals, and a legacy total whose components sum below zero; assert every result is zero.
- Test valid positive amounts and the precedence order.
- Run the statement payout unit tests.

Closes #19443
