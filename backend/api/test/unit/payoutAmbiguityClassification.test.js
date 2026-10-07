import { describe, it, expect } from 'vitest';
import { isAmbiguousDispatchError } from '../../src/workers/withdrawalSettlementWorker.js';

/**
 * Every message here is a real string thrown by
 * backend/api/src/services/wallet/payoutProvider.js. The three "ambiguous" cases
 * marked below were previously classified as safe-to-refund, which restored the
 * reserved funds on payouts that may already have been sent.
 */
const REAL_MESSAGES = {
  // dispatchPayout:36 - thrown before fetch(), money provably did not move.
  invalidAmount: 'Invalid withdrawal amount: NaN. Amount must be a positive number.',
  // dispatchPayout:42 - thrown before fetch().
  noProvider: 'No withdrawal payout provider configured (WITHDRAWAL_PAYOUT_PROVIDER / WITHDRAWAL_PAYOUT_WEBHOOK_URL).',
  // dispatchPayout:92 - thrown before fetch().
  unsupported: 'Withdrawal payout provider "bogus" is not supported yet.',

  // dispatchPayout:69 - AbortSignal.timeout fired. The payout may or may not
  // have been accepted. Note the message contains none of the substrings the old
  // classifier looked for.
  timeout: 'Payout webhook did not respond within 10000ms.',

  // dispatchPayout:75 - a 2xx means the provider accepted the payout; we just
  // could not read the reference out of the body.
  okWithoutRef: 'Payout webhook returned HTTP 200 but body contains no settlement_ref or reference.',

  rateLimited: 'Payout webhook returned HTTP 429.',
  requestTimeout: 'Payout webhook returned HTTP 408.',
  serverError: 'Payout webhook returned HTTP 500.',
  badRequest: 'Payout webhook returned HTTP 400.',
  unprocessable: 'Payout webhook returned HTTP 422.',

  connectionReset: 'read ECONNRESET',
  socketHangUp: 'socket hang up',
  dnsFailure: 'getaddrinfo ENOTFOUND payouts.example.com',
  // A parse failure on an otherwise successful response. response.json() is
  // swallowed to null at dispatchPayout:78, so this surfaces as okWithoutRef.
  jsonParse: 'Unexpected token < in JSON at position 0',
  empty: '',
};

describe('isAmbiguousDispatchError', () => {
  it('treats only provably-undispatched validations as safe to refund', () => {
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.invalidAmount))).toBe(false);
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.noProvider))).toBe(false);
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.unsupported))).toBe(false);
  });

  it('treats the AbortSignal timeout as ambiguous', () => {
    // The regression this fix exists for: the old substring classifier matched
    // none of /timeout|network|socket|5\d\d/ in "did not respond within 10000ms",
    // so a timeout refunded funds on an indeterminate payout.
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.timeout))).toBe(true);
  });

  it('treats a 2xx without a settlement_ref as ambiguous', () => {
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.okWithoutRef))).toBe(true);
  });

  it('treats non-5xx indeterminate HTTP statuses as ambiguous', () => {
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.rateLimited))).toBe(true);
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.requestTimeout))).toBe(true);
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.serverError))).toBe(true);
  });

  it('treats transport and parse failures as ambiguous', () => {
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.connectionReset))).toBe(true);
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.socketHangUp))).toBe(true);
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.dnsFailure))).toBe(true);
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.jsonParse))).toBe(true);
  });

  it('defaults to ambiguous for anything unrecognised', () => {
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.badRequest))).toBe(true);
    expect(isAmbiguousDispatchError(new Error(REAL_MESSAGES.unprocessable))).toBe(true);
    expect(isAmbiguousDispatchError(new Error(''))).toBe(true);
    expect(isAmbiguousDispatchError(new Error('some vendor specific failure'))).toBe(true);
    expect(isAmbiguousDispatchError({})).toBe(true);
    expect(isAmbiguousDispatchError(undefined)).toBe(true);
  });

  it('matches regardless of message casing', () => {
    expect(isAmbiguousDispatchError(new Error('INVALID WITHDRAWAL AMOUNT: 0'))).toBe(false);
    expect(isAmbiguousDispatchError(new Error('PAYOUT WEBHOOK DID NOT RESPOND WITHIN 10000MS'))).toBe(true);
  });
});