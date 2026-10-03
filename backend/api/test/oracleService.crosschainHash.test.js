import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/order/deliveryVerificationService.js', () => ({
  DeliveryVerificationService: vi.fn().mockImplementation(() => ({
    assertDriverAtDropoff: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock('../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
  supabaseAdmin: { from: vi.fn() },
}));

import OracleService from '../src/oracle/OracleService.js';

describe('OracleService.verifyCrossChain blockchain hash validation', () => {
  it.each([
    undefined,
    null,
    '',
    '0x1234',
    `0x${'g'.repeat(64)}`,
    `${'a'.repeat(64)}`,
    `0x${'a'.repeat(63)}`,
    `0x${'a'.repeat(65)}`,
  ])('rejects malformed hash %j before touching persistence', async (blockchainHash) => {
    const from = vi.fn();
    const service = new OracleService({ supabase: { from } });

    const result = await service.verifyCrossChain(
      '00000000-0000-4000-8000-000000000001',
      blockchainHash,
    );

    expect(result).toMatchObject({
      verified: false,
      verificationUrl: null,
      error: 'Invalid blockchain transaction hash',
      code: 'INVALID_BLOCKCHAIN_HASH',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('allows a canonical bytes32 transaction hash to reach the order lookup', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: '00000000-0000-4000-8000-000000000001',
        blockchain_tx_hash: `0x${'a'.repeat(64)}`,
        escrow_status: 'funded',
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const service = new OracleService({ supabase: { from } });

    const blockchainHash = `0x${'A'.repeat(64)}`;
    const result = await service.verifyCrossChain(
      '00000000-0000-4000-8000-000000000001',
      blockchainHash,
    );

    expect(result.verified).toBe(true);
    expect(from).toHaveBeenCalledWith('orders');
    expect(result.verificationUrl).toBe(
      `https://polygonscan.com/tx/0x${'a'.repeat(64)}`,
    );
  });
});
