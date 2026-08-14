import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

const { default: axios } = await import('axios');

const { FlashbotsRelayerService, getMevRelayer } = await import('../../../mev/flashbots_relayer.js');

describe('FlashbotsRelayerService (issue #10183)', () => {
  const KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';

  beforeEach(() => {
    delete process.env.RELAYER_WALLET_PRIVATE_KEY;
    delete process.env.FLASHBOTS_BUNDLE_VERSION;
    process.env.FLASHBOTS_RELAY_URL = 'https://relay.example.com';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('can be imported without RELAYER_WALLET_PRIVATE_KEY', () => {
    expect(FlashbotsRelayerService).toBeTypeOf('function');
  });

  it('getMevRelayer throws lazily when no key is configured', () => {
    expect(() => getMevRelayer()).toThrow(/RELAYER_WALLET_PRIVATE_KEY/);
  });

  it('getMevRelayer returns a relayer when a key is configured', () => {
    process.env.RELAYER_WALLET_PRIVATE_KEY = KEY;
    expect(getMevRelayer()).toBeInstanceOf(FlashbotsRelayerService);
  });

  it('sendPrivateBundle posts an eth_sendBundle request to the relay', async () => {
    process.env.RELAYER_WALLET_PRIVATE_KEY = KEY;
    process.env.FLASHBOTS_RELAY_URL = 'https://relay.example.com';
    axios.post.mockResolvedValue({ data: { result: { bundleHash: '0x1234' } } });

    const relayer = getMevRelayer();
    const bundle = { signedBundle: ['0x01'], targetBlock: 12345 };
    const result = await relayer.sendPrivateBundle(bundle);

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, rawBody, opts] = axios.post.mock.calls[0];
    expect(url).toBe('https://relay.example.com');

    // Flashbots requires the payload to be sent as the raw JSON string so the
    // X-Flashbots-Signature can be verified against the exact signed bytes.
    expect(typeof rawBody).toBe('string');
    const body = JSON.parse(rawBody);
    expect(body.method).toBe('eth_sendBundle');
    expect(body.params[0].txs).toEqual(['0x01']);
    expect(body.params[0].blockNumber).toBe('0x3039');
    expect(body.params[0].version).toBe('v3');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-Flashbots-Signature']).toMatch(/^0x[0-9a-fA-F]{40}:/);
    expect(result).toEqual({
      success: true,
      bundleHash: '0x1234',
      targetBlock: 12345,
    });
  });

  it('throws when the relay returns an error payload', async () => {
    process.env.RELAYER_WALLET_PRIVATE_KEY = KEY;
    axios.post.mockResolvedValue({
      data: { error: { message: 'chain does not support this address' } },
    });

    const relayer = getMevRelayer();
    await expect(
      relayer.sendPrivateBundle({ signedBundle: ['0x01'], targetBlock: 1 })
    ).rejects.toThrow(/chain does not support this address/);
  });
});
