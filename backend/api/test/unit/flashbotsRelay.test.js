import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock, eventBusMock } = vi.hoisted(() => ({
  dbMock: {
    supabaseAdmin: { from: vi.fn() },
    supabase: { from: vi.fn() },
  },
  eventBusMock: {
    emitSafe: vi.fn(),
    publish: vi.fn(),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabaseAdmin: dbMock.supabaseAdmin,
  supabase: dbMock.supabase,
}));

vi.mock('../../src/core/events.js', () => ({
  eventBus: eventBusMock,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { FlashbotsRelay, BundleExecutedEvent } from '../../src/services/payment/flashbotsRelay.js';

describe('FlashbotsRelay service', () => {
  let relay;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    relay = new FlashbotsRelay('https://polygon-rpc.com', '0x' + '1'.repeat(64), {
      flashbotsRelayUrl: 'https://relay.example.com',
    });
  });

  describe('BundleExecutedEvent', () => {
    it('creates a BaseEvent with BundleExecuted type and payload', () => {
      const payload = { bundleHash: '0xabc', targetBlock: 100 };
      const event = new BundleExecutedEvent(payload);
      expect(event.eventType).toBe('BundleExecuted');
      expect(event.payload).toEqual(payload);
      expect(event.source).toBe('FlashbotsRelay');
    });
  });

  describe('persistBundleResults', () => {
    it('persists bundle results to flashbots_submissions table', async () => {
      const insertMock = vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 1, bundle_hash: '0x123' },
            error: null,
          }),
        })),
      }));
      dbMock.supabaseAdmin.from.mockReturnValue({ insert: insertMock });

      const bundleResult = {
        bundleHash: '0x123',
        targetBlock: 12345,
        txs: ['0xraw1'],
        status: 'submitted',
      };

      const result = await relay.persistBundleResults(bundleResult);
      expect(result).toEqual({ id: 1, bundle_hash: '0x123' });
      expect(dbMock.supabaseAdmin.from).toHaveBeenCalledWith('flashbots_submissions');
      expect(insertMock).toHaveBeenCalledWith([
        expect.objectContaining({
          bundle_hash: '0x123',
          target_block: 12345,
          status: 'submitted',
        }),
      ]);
    });

    it('falls back to flashbots_bundles table when flashbots_submissions fails', async () => {
      const submissionsInsertMock = vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Table does not exist' },
          }),
        })),
      }));

      const fallbackInsertMock = vi.fn().mockResolvedValue({ data: null, error: null });

      dbMock.supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'flashbots_submissions') {
          return { insert: submissionsInsertMock };
        }
        if (table === 'flashbots_bundles') {
          return { insert: fallbackInsertMock };
        }
        return { insert: vi.fn() };
      });

      const bundleResult = {
        bundleHash: '0xfallback123',
        targetBlock: 54321,
      };

      await relay.persistBundleResults(bundleResult);
      expect(fallbackInsertMock).toHaveBeenCalledWith([
        expect.objectContaining({
          bundle_id: '0xfallback123',
          block_number: 54321,
        }),
      ]);
    });
  });

  describe('emitBundleExecuted', () => {
    it('emits BundleExecuted event via eventBus', () => {
      const bundleResult = { bundleHash: '0x456', targetBlock: 999 };
      const event = relay.emitBundleExecuted(bundleResult);

      expect(event).toBeInstanceOf(BundleExecutedEvent);
      expect(eventBusMock.emitSafe).toHaveBeenCalledWith('BundleExecuted', expect.any(BundleExecutedEvent));
      expect(eventBusMock.emitSafe).toHaveBeenCalledWith('bundle.executed', expect.any(BundleExecutedEvent));
    });
  });

  describe('sendPrivateBundle', () => {
    it('successfully submits bundle, pushes to bundleResults, persists to DB, and emits event', async () => {
      const insertMock = vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
        })),
      }));
      dbMock.supabaseAdmin.from.mockReturnValue({ insert: insertMock });

      global.fetch.mockResolvedValue({
        json: vi.fn().mockResolvedValue({ result: '0xbundlehash999' }),
      });

      const bundle = {
        signedBundle: ['0xtx1', '0xtx2'],
        targetBlock: 123456,
      };

      const result = await relay.sendPrivateBundle(bundle);

      expect(result.success).toBe(true);
      expect(result.bundleHash).toBe('0xbundlehash999');
      expect(result.targetBlock).toBe(123456);
      expect(relay.bundleResults).toHaveLength(1);
      expect(relay.bundleResults[0].bundleHash).toBe('0xbundlehash999');
      expect(dbMock.supabaseAdmin.from).toHaveBeenCalledWith('flashbots_submissions');
      expect(eventBusMock.emitSafe).toHaveBeenCalledWith('BundleExecuted', expect.any(BundleExecutedEvent));
    });

    it('throws when bundle parameter is invalid', async () => {
      await expect(relay.sendPrivateBundle(null)).rejects.toThrow(/Invalid bundle parameter/);
      await expect(relay.sendPrivateBundle({ signedBundle: [] })).rejects.toThrow(/Invalid bundle parameter/);
    });

    it('throws and does not persist or emit event when relay returns error', async () => {
      global.fetch.mockResolvedValue({
        json: vi.fn().mockResolvedValue({ error: { message: 'Bundle simulated with error' } }),
      });

      const bundle = {
        signedBundle: ['0xtx1'],
        targetBlock: 100,
      };

      await expect(relay.sendPrivateBundle(bundle)).rejects.toThrow(/Flashbots relay rejected bundle/);
      expect(relay.bundleResults).toHaveLength(0);
      expect(dbMock.supabaseAdmin.from).not.toHaveBeenCalled();
      expect(eventBusMock.emitSafe).not.toHaveBeenCalled();
    });
  });
});
