import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/config/db.js', () => ({
  supabase: null,
  supabaseAdmin: null,
}));

import { isPayoutProviderConfigured } from '../../../../src/services/wallet/payoutProvider.js';


describe('PayoutProvider', () => {
  it('checks if payout provider is configured', () => {
    expect(typeof isPayoutProviderConfigured()).toBe('boolean');
  });
});
