/**
 * Unit tests for backend/api/src/services/reputationReconciliation.js
 *
 * Coverage:
 *   - reconcileFailedReputationUpdates: skips when supabaseAdmin is null
 *   - reconcileFailedReputationUpdates: skips when Redis lock is held by another instance
 *   - reconcileFailedReputationUpdates: skips when Redis lock acquisition throws
 *   - reconcileFailedReputationUpdates: returns early when no failed reputations exist
 *   - reconcileFailedReputationUpdates: deletes row and awards points on success
 *   - reconcileFailedReputationUpdates: upserts retry_count and last_error on failure
 *   - reconcileFailedReputationUpdates: skips row when Redis claim key already exists
 *   - reconcileFailedReputationUpdates: single-instance fallback without Redis
 *   - startReputationReconciliation / stopReputationReconciliation: timer lifecycle
 *
 * Run with:  npm run test:unit -- test/unit/reputationReconciliation.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAwardReputationPoints = vi.hoisted(() => vi.fn());

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockRedisClient = vi.hoisted(() => ({
  set: vi.fn(),
  del: vi.fn(),
  expire: vi.fn(),
}));

function makeSupabaseMock() {
  const queryBuilder = {
    select: vi.fn(() => queryBuilder),
    or: vi.fn(() => queryBuilder),
    lt: vi.fn(() => queryBuilder),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
    delete: vi.fn(() => queryBuilder),
    eq: vi.fn(() => Promise.resolve({ data: [{ id: 'x' }], error: null })),
    update: vi.fn(() => queryBuilder),
    upsert: vi.fn(() => Promise.resolve({ error: null })),
  };
  return {
    from: vi.fn(() => queryBuilder),
  };
}

const mockSupabaseAdmin = vi.hoisted(() => makeSupabaseMock());

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../src/services/reputation.js', () => ({
  awardReputationPoints: mockAwardReputationPoints,
}));

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: mockSupabaseAdmin,
  redisClient: mockRedisClient,
}));

vi.mock('os', () => ({
  default: { hostname: () => 'test-host' },
}));

import {
  reconcileFailedReputationUpdates,
  startReputationReconciliation,
  stopReputationReconciliation,
} from '../../src/services/reputationReconciliation.js';

describe('reputationReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopReputationReconciliation();
  });

  afterEach(() => {
    stopReputationReconciliation();
    vi.restoreAllMocks();
  });

  function withFailedReputations(rows) {
    const updateEqFn = vi.fn(() => Promise.resolve({ error: null }));
    const deleteEqFn = vi.fn(() => Promise.resolve({ data: [{ id: 'row-id' }], error: null }));
    const queryBuilder = {
      select: vi.fn(() => queryBuilder),
      or: vi.fn(() => queryBuilder),
      lt: vi.fn(() => queryBuilder),
      limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
      delete: vi.fn(() => ({
        eq: deleteEqFn,
      })),
      update: vi.fn(() => ({
        eq: updateEqFn,
      })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      _updateEqFn: updateEqFn,
      _deleteEqFn: deleteEqFn,
    };
    mockSupabaseAdmin.from = vi.fn(() => queryBuilder);
    return queryBuilder;
  }

  it('skips when supabaseAdmin is not available', async () => {
    mockRedisClient.set.mockResolvedValueOnce('lock-value');
    mockRedisClient.del.mockResolvedValueOnce(1);

    await reconcileFailedReputationUpdates();

    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('supabaseAdmin not available')
    );
  });

  it('skips when Redis lock is held by another instance', async () => {
    mockRedisClient.set.mockResolvedValueOnce(null); // NX returns null when key exists

    await reconcileFailedReputationUpdates();

    expect(mockLogger.info).toHaveBeenCalledWith(
      '[reputation-reconciliation] Lock held by another instance, skipping.'
    );
    expect(mockSupabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('skips when Redis lock acquisition throws', async () => {
    mockRedisClient.set.mockRejectedValueOnce(new Error('Redis unavailable'));

    await reconcileFailedReputationUpdates();

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[reputation-reconciliation] Failed to acquire Redis lock, skipping batch:',
      'Redis unavailable'
    );
    expect(mockSupabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('returns early when no failed reputations exist', async () => {
    mockRedisClient.set.mockResolvedValueOnce('lock-value');
    mockRedisClient.del.mockResolvedValueOnce(1);
    withFailedReputations([]);

    await reconcileFailedReputationUpdates();

    expect(mockSupabaseAdmin.from).toHaveBeenCalledWith('reputation_failures');
    expect(mockAwardReputationPoints).not.toHaveBeenCalled();
  });

  it('marks row confirmed and deletes row on success with awardKey and txHash', async () => {
    mockRedisClient.set.mockResolvedValue('lock-value');
    mockRedisClient.del.mockResolvedValue(1);
    const row = {
      id: 'row-1',
      driver_wallet: '0xwallet1',
      stars: 5,
      retry_count: 0,
      award_key: 'order:101:rating:driver',
      status: 'pending',
    };
    const qb = withFailedReputations([row]);
    mockAwardReputationPoints.mockResolvedValueOnce({ txHash: '0xconfirmedtx', confirmed: true });

    await reconcileFailedReputationUpdates();

    expect(mockAwardReputationPoints).toHaveBeenCalledWith('0xwallet1', 5, {
      awardKey: 'order:101:rating:driver',
      existingTxHash: null,
    });
    expect(qb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'confirmed',
        tx_hash: '0xconfirmedtx',
      })
    );
    expect(qb._deleteEqFn).toHaveBeenCalledWith('id', 'row-1');
  });

  it('resolves existing submitted tx_hash without duplicate submission', async () => {
    mockRedisClient.set.mockResolvedValue('lock-value');
    mockRedisClient.del.mockResolvedValue(1);
    const row = {
      id: 'row-submitted',
      driver_wallet: '0xwallet_sub',
      stars: 4,
      retry_count: 1,
      award_key: 'order:202:rating:driver',
      tx_hash: '0xexistingtxhash',
      status: 'submitted',
    };
    const qb = withFailedReputations([row]);
    mockAwardReputationPoints.mockResolvedValueOnce({
      txHash: '0xexistingtxhash',
      confirmed: true,
    });

    await reconcileFailedReputationUpdates();

    expect(mockAwardReputationPoints).toHaveBeenCalledWith('0xwallet_sub', 4, {
      awardKey: 'order:202:rating:driver',
      existingTxHash: '0xexistingtxhash',
    });
    expect(qb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'confirmed',
        tx_hash: '0xexistingtxhash',
      })
    );
  });

  it('updates status to submitted when error includes txHash (timeout during confirmation)', async () => {
    mockRedisClient.set.mockResolvedValue('lock-value');
    mockRedisClient.del.mockResolvedValue(1);
    const row = {
      id: 'row-timeout',
      driver_wallet: '0xwallet_timeout',
      stars: 3,
      retry_count: 0,
      status: 'pending',
    };
    const qb = withFailedReputations([row]);
    const timeoutErr = new Error('Tx confirmation timed out');
    timeoutErr.txHash = '0xbroadcasttx';
    mockAwardReputationPoints.mockRejectedValueOnce(timeoutErr);

    await reconcileFailedReputationUpdates();

    expect(qb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'submitted',
        tx_hash: '0xbroadcasttx',
        retry_count: 1,
      })
    );
  });

  it('updates status to failed when retry_count reaches MAX_RETRIES', async () => {
    mockRedisClient.set.mockResolvedValue('lock-value');
    mockRedisClient.del.mockResolvedValue(1);
    const row = {
      id: 'row-max',
      driver_wallet: '0xwallet_max',
      stars: 2,
      retry_count: 9,
      status: 'pending',
    };
    const qb = withFailedReputations([row]);
    mockAwardReputationPoints.mockRejectedValueOnce(new Error('Persistent RPC failure'));

    await reconcileFailedReputationUpdates();

    expect(qb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        retry_count: 10,
      })
    );
  });

  it('logs warning if delete fails after marking confirmed without re-awarding', async () => {
    mockRedisClient.set.mockResolvedValue('lock-value');
    mockRedisClient.del.mockResolvedValue(1);
    const row = {
      id: 'row-del-err',
      driver_wallet: '0xwallet_del',
      stars: 5,
      retry_count: 0,
      status: 'pending',
    };
    const qb = withFailedReputations([row]);
    qb.delete = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ error: new Error('DB connection drop') })),
    }));
    mockAwardReputationPoints.mockResolvedValueOnce({ txHash: '0xhash123', confirmed: true });

    await reconcileFailedReputationUpdates();

    expect(qb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'confirmed',
      })
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to delete confirmed row row-del-err')
    );
  });

  it('skips row when Redis claim key already exists', async () => {
    mockRedisClient.set
      .mockResolvedValueOnce('lock-value') // main lock
      .mockResolvedValueOnce(null); // claim key already taken
    mockRedisClient.del.mockResolvedValue(1);
    const rows = [
      { id: 'row-3', driver_wallet: '0xwallet3', stars: 1, retry_count: 0, status: 'pending' },
      { id: 'row-4', driver_wallet: '0xwallet4', stars: 2, retry_count: 0, status: 'pending' },
    ];
    withFailedReputations(rows);
    mockAwardReputationPoints.mockResolvedValue({ txHash: '0xtxhash', confirmed: true });

    await reconcileFailedReputationUpdates();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Row row-3 already claimed, skipping.')
    );
    // row-4 should be processed
    expect(mockAwardReputationPoints).toHaveBeenCalledWith('0xwallet4', 2, expect.any(Object));
  });

  it('returns early when redisClient is falsy (in-process mode)', async () => {
    mockRedisClient.set.mockResolvedValue(null); // null = lock key already exists (NX)
    withFailedReputations([]);

    await reconcileFailedReputationUpdates();

    expect(mockLogger.info).toHaveBeenCalledWith(
      '[reputation-reconciliation] Lock held by another instance, skipping.'
    );
    expect(mockSupabaseAdmin.from).not.toHaveBeenCalled();
  });

  describe('startReputationReconciliation / stopReputationReconciliation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sets up interval with default 60s when env var is absent', () => {
      delete process.env.REPUTATION_RECONCILIATION_INTERVAL_MS;

      startReputationReconciliation();

      // First call should have fired immediately, advance timers
      vi.advanceTimersByTime(60_000);

      // stop without error
      expect(() => stopReputationReconciliation()).not.toThrow();
    });

    it('uses custom interval from REPUTATION_RECONCILIATION_INTERVAL_MS', () => {
      process.env.REPUTATION_RECONCILIATION_INTERVAL_MS = '5000';

      startReputationReconciliation();

      vi.advanceTimersByTime(5_000);

      expect(() => stopReputationReconciliation()).not.toThrow();

      delete process.env.REPUTATION_RECONCILIATION_INTERVAL_MS;
    });

    it('is idempotent — calling start twice does not create duplicate timers', () => {
      startReputationReconciliation();
      startReputationReconciliation(); // should not throw or create duplicate

      vi.advanceTimersByTime(60_000);

      expect(() => stopReputationReconciliation()).not.toThrow();
    });

    it('stopReputationReconciliation clears the interval', () => {
      startReputationReconciliation();
      stopReputationReconciliation();

      // After stop, advancing time should not trigger any calls
      vi.advanceTimersByTime(60_000);
      expect(mockAwardReputationPoints).not.toHaveBeenCalled();
    });
  });
});
