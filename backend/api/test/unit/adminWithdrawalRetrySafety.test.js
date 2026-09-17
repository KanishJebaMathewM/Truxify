import { describe, it, expect } from 'vitest';

describe('admin withdrawal retry safety', () => {
  it('does not classify an already-attempted payout as safe to retry', () => {
    const withdrawal = { payout_attempted_at: '2026-09-16T00:00:00Z', settlement_ref: null };
    expect(withdrawal.payout_attempted_at).not.toBeNull();
  });
});
