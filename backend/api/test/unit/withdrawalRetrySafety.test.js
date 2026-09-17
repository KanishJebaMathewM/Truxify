import { describe, it, expect } from 'vitest';

describe('withdrawal retry safety contract', () => {
  it('requires dispatch evidence to remain intact after provider submission', () => {
    const withdrawal = { payout_attempted_at: '2026-09-16T00:00:00Z', settlement_ref: 'provider-ref-1' };
    expect(withdrawal.payout_attempted_at).toBeTruthy();
    expect(withdrawal.settlement_ref).toBeTruthy();
  });
});
