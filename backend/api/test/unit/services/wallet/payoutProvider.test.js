import { describe, it, expect } from 'vitest';
import { isPayoutProviderConfigured } from '../../../../src/services/wallet/payoutProvider.js';

describe('PayoutProvider', () => {
  it('checks if payout provider is configured', () => {
    expect(typeof isPayoutProviderConfigured()).toBe('boolean');
  });
});
