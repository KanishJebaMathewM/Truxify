import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Pin the DB clients to null so persistBundleResults takes its
// 'Database client unavailable' skip path deterministically — otherwise a
// harness setup.js that initializes real Supabase clients routes the persist
// write through the fetch mock and inflates the call count.
vi.mock('../../src/config/db.js', () => ({
  supabase: null,
  supabaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

const { default: axios } = await import('axios');

// Current module shape: FlashbotsRelay class + flashbotsRelay singleton.
const { FlashbotsRelay, flashbotsRelay } = await import('../../src/services/payment/flashbotsRelay.js');
const FlashbotsRelayerService = FlashbotsRelay;
const getMevRelayer = () => flashbotsRelay;

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

  it('rejects bundle submission when no key is configured (fail-soft singleton)', async () => {
    // The current module constructs its singleton at import without throwing;
    // submission without a relayer key fails at send time.
    const relayer = getMevRelayer();
    await expect(
      relayer.sendPrivateBundle({ signedBundle: ['0x01'], targetBlock: 12345 })
    ).rejects.toThrow();
  });

  it('getMevRelayer returns a relayer when a key is configured', () => {
    process.env.RELAYER_WALLET_PRIVATE_KEY = KEY;
    expect(getMevRelayer()).toBeInstanceOf(FlashbotsRelayerService);
  });

  it('sendPrivateBundle posts an eth_sendBundle request to the relay', async () => {
    process.env.RELAYER_WALLET_PRIVATE_KEY = KEY;
    process.env.FLASHBOTS_RELAY_URL = 'https://relay.example.com';
    // The service posts with global fetch (the axios-era suite mocked axios).
    const fetchMock = vi.fn().mockResolvedValue({
      // Without ok:true the service treats the response as a failure and
      // walks its relay fallback chain (the phantom extra fetches).
      ok: true,
      json: async () => ({ result: '0x1234' }),
      text: async () => '{"result":"0x1234"}',
    });
    vi.stubGlobal('fetch', fetchMock);

    const relayer = new FlashbotsRelayerService(null, KEY, { flashbotsRelayUrl: 'https://relay.example.com' });
    const bundle = { signedBundle: ['0x01'], targetBlock: 12345 };
    const result = await relayer.sendPrivateBundle(bundle);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    const rawBody = opts.body;
    expect(url).toBe('https://relay.example.com');

    // Flashbots requires the payload to be sent as the raw JSON string so the
    // X-Flashbots-Signature can be verified against the exact signed bytes.
    expect(typeof rawBody).toBe('string');
    const body = JSON.parse(rawBody);
    expect(body.method).toBe('eth_sendBundle');
    expect(body.params[0].txs).toEqual(['0x01']);
    expect(body.params[0].blockNumber).toBe('0x3039');
    // (the v3 version param existed only in the retired mev module)
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-Flashbots-Signature']).toMatch(/^0x[0-9a-fA-F]{40}:/);
    // The result is enriched for persistence (rawPayload/status/submittedAt/txs).
    expect(result).toMatchObject({
      success: true,
      bundleHash: '0x1234',
      targetBlock: 12345,
    });
  });

  it('throws when the relay returns an error payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ error: { message: 'chain does not support this address' } }),
    }));
    process.env.RELAYER_WALLET_PRIVATE_KEY = KEY;
    axios.post.mockResolvedValue({
      data: { error: { message: 'chain does not support this address' } },
    });

    const relayer = new FlashbotsRelayerService(null, KEY, { flashbotsRelayUrl: 'https://relay.example.com' });
    await expect(
      relayer.sendPrivateBundle({ signedBundle: ['0x01'], targetBlock: 1 })
    ).rejects.toThrow(/chain does not support this address/);
  });
});
