/**
 * Vitest global setup — runs once before any test file.
 *
 * Set environment variables needed by the routes under test BEFORE the
 * route modules are imported. (The auth middleware reads BYPASS_AUTH at
 * request time, but we set it eagerly so any module-level branches see
 * the bypassed state too.)
 */

// Required by auth.js middleware to read x-user-id/x-user-role headers
// directly from the request instead of verifying a Firebase token.
process.env.BYPASS_AUTH = 'true';
process.env.MONGODB_SHUTDOWN_WAIT_MS = '0';
process.env.ESCROW_MATIC_PER_PAISA = '0.01';
process.env.MAX_ESCROW_MATIC = '1000';

// Suppress noisy console.error output from the routes — they log
// pricing errors and DB failures to stderr when tests trigger them.
// We still fail the test if the response status is wrong.
const originalError = console.error;
console.error = (...args) => {
  const msg = args[0];
  if (typeof msg === 'string' && (
    msg.startsWith('Pricing computation error') ||
    msg.startsWith('Order Insertion Error') ||
    msg.startsWith('Load Offer Insertion Error') ||
    msg.startsWith('Timeline Insertion Error') ||
    msg.startsWith('Auth verification error')
  )) {
    return;
  }
  originalError(...args);
};
