import { describe, it, expect, vi } from 'vitest';

const TEST_KEY = '0x' + '1'.repeat(64);

describe('submitFlashbotsBundle', () => {
  it('signs transactions, submits to the relay, and returns a real bundleId', async () => {
    process.env.RELAYER_WALLET_PRIVATE_KEY = TEST_KEY;
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';

    const mev = (await import('./mev.service.js')).default;

    // Avoid real RPC / DB calls during the test.
    mev._provider = { getBlockNumber: async () => 100 };
    const storeBundle = vi.fn(async () => {});
    mev.storeBundle = storeBundle;

    const fetchMock = vi.fn(async () => ({
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0xrealbundlehash' }),
    }));
    global.fetch = fetchMock;

    const unsignedTx = { to: '0x' + '2'.repeat(40), value: 1, gasLimit: 21000 };
    const result = await mev.submitFlashbotsBundle('escrow-1', [unsignedTx]);

    expect(result.bundleHash).toBe('0xrealbundlehash');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // The submitted tx must be a signed (serialized) string, not the raw object.
    expect(typeof body.params[0].txs[0]).toBe('string');
    expect(body.params[0].txs[0]).not.toBe(unsignedTx);

    expect(storeBundle).toHaveBeenCalledWith(
      expect.objectContaining({ escrowId: 'escrow-1', bundleId: '0xrealbundlehash' })
    );
  });
});
