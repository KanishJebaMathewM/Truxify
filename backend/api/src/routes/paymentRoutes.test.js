```js
/**
 * Pure helper functions used by paymentRoutes.js.
 *
 * These functions intentionally have no Express, Redis, database,
 * blockchain, or environment dependencies so they can be unit tested.
 */

/**
 * Check whether a payment amount exactly matches the expected
 * order amount.
 *
 * Amounts are represented in paisa.
 *
 * @param {unknown} requestedAmount
 * @param {unknown} expectedAmount
 * @returns {boolean}
 */
export function isValidPaymentAmount(
  requestedAmount,
  expectedAmount
) {
  const requested = Number(requestedAmount);
  const expected = Number(expectedAmount);

  return (
    Number.isSafeInteger(requested) &&
    requested > 0 &&
    Number.isSafeInteger(expected) &&
    expected >= 0 &&
    requested === expected
  );
}

/**
 * Format paisa as INR.
 *
 * @param {unknown} amountPaisa
 * @returns {string|null}
 */
export function formatAmountInr(amountPaisa) {
  if (
    amountPaisa === null ||
    amountPaisa === undefined ||
    amountPaisa === ''
  ) {
    return null;
  }

  const amount = Number(amountPaisa);

  if (!Number.isFinite(amount)) {
    return null;
  }

  return (amount / 100).toFixed(2);
}

/**
 * Build a UPI payment deep link.
 *
 * @param {string} platformUpiId
 * @param {string} orderRef
 * @param {unknown} amountPaisa
 * @returns {string}
 */
export function buildUpiDeepLink(
  platformUpiId,
  orderRef,
  amountPaisa
) {
  const amountInr = formatAmountInr(amountPaisa);

  if (!platformUpiId) {
    throw new Error('platformUpiId is required');
  }

  if (!orderRef) {
    throw new Error('orderRef is required');
  }

  if (amountInr === null) {
    throw new Error('A valid payment amount is required');
  }

  return (
    `upi://pay?pa=${encodeURIComponent(platformUpiId)}` +
    `&pn=${encodeURIComponent('Truxify')}` +
    `&am=${encodeURIComponent(amountInr)}` +
    `&cu=INR` +
    `&tn=${encodeURIComponent(orderRef)}`
  );
}

/**
 * Validate a Polygon wallet address.
 *
 * @param {unknown} address
 * @returns {boolean}
 */
export function isValidPolygonAddress(address) {
  return (
    typeof address === 'string' &&
    /^0x[a-fA-F0-9]{40}$/.test(address)
  );
}
```
