/**
 * Unit tests for backend/api/src/services/escrowReleaseReconciliation.js
 *
 * The reconciler heals the release→finalize window: an on-chain release that
 * succeeded but whose `complete_trip_tx` never ran. It sweeps
 * `release_failed`/`released`/`funded` orders, consults the on-chain booking
 * (source of truth), persists release evidence via the service-role repository
 * and finalizes the trip with `complete_trip_tx` (service_role, no OTP).
 *
 * Coverage:
 *   - no repository / no supabaseAdmin → skip cycle
 *   - Redis unavailable → LockAcquisitionError → skip cycle
 *   - global lock held by another instance → skip batch
 *   - no pending orders → early return
 *   - on-chain released → persist evidence + complete_trip_tx (p_otp_id null)
 *   - release_failed + not on-chain → retry escrowRelease then finalize
 *   - funded + not on-chain → never auto-release
 *   - complete_trip_tx error → record attempt error, do not credit
 *   - already-finalized orders skipped (idempotent)
 *   - per-order + global lock cleanup
 *   - timer lifecycle
 *
 * Run with:  npm run test:unit -- test/unit/escrowReleaseReconciliation.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEscrowRelease = vi.hoisted(() => vi.fn());
const mockGetEscrowBooking = vi.hoisted(() => vi.fn());

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockAcquireLock = vi.hoisted(() => vi.fn());
const mockReleaseLock = vi.hoisted(() => vi.fn());
const mockRenewLock = vi.hoisted(() => vi.fn());

// Mutable via getter so individual tests can simulate an unconfigured admin client.
const mockSupabaseAdmin = vi.hoisted(() => ({ available: true }));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() {
    return mockSupabaseAdmin.available ? mockSupabaseAdmin : null;
  },
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: mockAcquireLock,
  releaseLock: mockReleaseLock,
  renewLock: mockRenewLock,
  LockAcquisitionError: class LockAcquisitionError extends Error {},
}));

vi.mock('../../src/services/escrow.js', () => ({
  escrowRelease: mockEscrowRelease,
  getEscrowBooking: mockGetEscrowBooking,
  getEscrowBookingId: (displayId) => displayId,
}));

import {
  reconcilePendingEscrowReleases,
  startEscrowReleaseReconciliation,
  stopEscrowReleaseReconciliation,
} from '../../src/services/escrowReleaseReconciliation.js';
import { LockAcquisitionError } from '../../src/lib/redisLock.js';

const GLOBAL_LOCK_KEY = 'escrow:release:reconciliation:lock';

function makeOrderRepositoryMock(overrides = {}) {
  const repo = {
    findPendingEscrowReleases: vi.fn(async () => ({ data: [], error: null })),
    findOrderById: vi.fn(async () => ({ data: null, error: null })),
    updateOrder: vi.fn(async () => ({ data: null, error: null })),
    executeRpc: vi.fn(async () => ({ data: null, error: null })),
    ...overrides,
  };
  return repo;
}

function releasedOrder(overrides = {}) {
  return {
    id: 'order-1',
    order_display_id: 'ORD-001',
    status: 'arriving',
    escrow_status: 'released',
    escrow_disabled: false,
    escrow_booking_id: null,
    escrow_release_attempts: 0,
    release_tx_hash: '0xabc',
    ...overrides,
  };
}

describe('escrowReleaseReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseAdmin.available = true;
    mockAcquireLock.mockResolvedValue('lock-token');
    mockReleaseLock.mockResolvedValue(true);
    mockRenewLock.mockResolvedValue(true);
    mockGetEscrowBooking.mockResolvedValue({ paid: true });
  });

  it('skips the cycle when no OrderRepository is provided', async () => {
    await reconcilePendingEscrowReleases(undefined);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No OrderRepository provided'),
    );
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });

  it('skips the cycle when supabaseAdmin is not configured', async () => {
    mockSupabaseAdmin.available = false;

    await reconcilePendingEscrowReleases(makeOrderRepositoryMock());

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('supabaseAdmin not available'),
    );
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });

  it('skips the cycle when Redis is unavailable (LockAcquisitionError)', async () => {
    mockAcquireLock.mockRejectedValue(new LockAcquisitionError(GLOBAL_LOCK_KEY, 'Redis down'));

    await reconcilePendingEscrowReleases(makeOrderRepositoryMock());

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Redis unavailable'),
      expect.any(String),
    );
  });

  it('skips the batch when the global lock is held by another instance', async () => {
    mockAcquireLock.mockResolvedValue(null);
    const repo = makeOrderRepositoryMock();

    await reconcilePendingEscrowReleases(repo);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Global lock held by another instance'),
    );
    expect(repo.findPendingEscrowReleases).not.toHaveBeenCalled();
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });

  it('returns early when there are no pending orders', async () => {
    const repo = makeOrderRepositoryMock();

    await reconcilePendingEscrowReleases(repo);

    expect(repo.findPendingEscrowReleases).toHaveBeenCalledOnce();
    expect(mockAcquireLock).toHaveBeenCalledWith(GLOBAL_LOCK_KEY, expect.any(Number));
    expect(mockReleaseLock).toHaveBeenCalled();
  });

  it('finalizes an on-chain released order: persists evidence then calls complete_trip_tx without an OTP', async () => {
    const repo = makeOrderRepositoryMock();
    repo.findPendingEscrowReleases.mockResolvedValue({ data: [releasedOrder()], error: null });
    repo.findOrderById.mockResolvedValue({ data: releasedOrder(), error: null });
    mockGetEscrowBooking.mockResolvedValue({ paid: true });

    await reconcilePendingEscrowReleases(repo);

    // Release evidence persisted via service-role repository
    expect(repo.updateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({
        escrow_status: 'released',
        release_tx_hash: '0xabc',
        escrow_release_error: null,
      }),
    );

    // complete_trip_tx invoked as service_role with p_otp_id null
    expect(repo.executeRpc).toHaveBeenCalledWith(
      'complete_trip_tx',
      { p_order_id: 'order-1', p_otp_id: null, p_release_tx_hash: '0xabc' },
      mockSupabaseAdmin,
    );

    // Per-order lock acquired and released
    expect(mockAcquireLock).toHaveBeenCalledWith('escrow_lock:order-1', expect.any(Number));
    expect(mockReleaseLock).toHaveBeenCalledWith('escrow_lock:order-1', 'lock-token');
  });

  it('retries the release for release_failed orders not on-chain, then finalizes', async () => {
    const repo = makeOrderRepositoryMock();
    repo.findPendingEscrowReleases.mockResolvedValue({
      data: [releasedOrder({ escrow_status: 'release_failed', release_tx_hash: null })],
      error: null,
    });
    repo.findOrderById.mockResolvedValue({
      data: releasedOrder({ escrow_status: 'release_failed', release_tx_hash: null }),
      error: null,
    });
    mockGetEscrowBooking.mockResolvedValue({ paid: false });
    mockEscrowRelease.mockResolvedValue({ txHash: '0xretry' });

    await reconcilePendingEscrowReleases(repo);

    expect(mockEscrowRelease).toHaveBeenCalledWith('ORD-001');
    expect(repo.executeRpc).toHaveBeenCalledWith(
      'complete_trip_tx',
      { p_order_id: 'order-1', p_otp_id: null, p_release_tx_hash: '0xretry' },
      mockSupabaseAdmin,
    );
  });

  it('never auto-releases a funded order that is not released on-chain', async () => {
    const repo = makeOrderRepositoryMock();
    repo.findPendingEscrowReleases.mockResolvedValue({
      data: [releasedOrder({ escrow_status: 'funded', release_tx_hash: null })],
      error: null,
    });
    repo.findOrderById.mockResolvedValue({
      data: releasedOrder({ escrow_status: 'funded', release_tx_hash: null }),
      error: null,
    });
    mockGetEscrowBooking.mockResolvedValue({ paid: false });

    await reconcilePendingEscrowReleases(repo);

    expect(mockEscrowRelease).not.toHaveBeenCalled();
    expect(repo.executeRpc).not.toHaveBeenCalled();
    expect(repo.updateOrder).not.toHaveBeenCalled();
  });

  it('records the attempt error and never credits when complete_trip_tx fails', async () => {
    const repo = makeOrderRepositoryMock();
    repo.findPendingEscrowReleases.mockResolvedValue({ data: [releasedOrder()], error: null });
    repo.findOrderById.mockResolvedValue({ data: releasedOrder(), error: null });
    repo.executeRpc.mockResolvedValue({ data: null, error: { message: 'gate rejected' } });

    await reconcilePendingEscrowReleases(repo);

    expect(repo.executeRpc).toHaveBeenCalled();
    expect(repo.updateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ escrow_release_attempts: 1 }),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Finalization failed'),
      expect.any(String),
    );
  });

  it('skips orders already finalized (status = payment_released)', async () => {
    const repo = makeOrderRepositoryMock();
    repo.findPendingEscrowReleases.mockResolvedValue({
      data: [releasedOrder({ status: 'payment_released' })],
      error: null,
    });
    repo.findOrderById.mockResolvedValue({
      data: releasedOrder({ status: 'payment_released' }),
      error: null,
    });

    await reconcilePendingEscrowReleases(repo);

    expect(mockGetEscrowBooking).not.toHaveBeenCalled();
    expect(repo.executeRpc).not.toHaveBeenCalled();
  });

  it('releases both the global and per-order locks in the finally block', async () => {
    const repo = makeOrderRepositoryMock();
    repo.findPendingEscrowReleases.mockResolvedValue({ data: [releasedOrder()], error: null });
    repo.findOrderById.mockResolvedValue({ data: releasedOrder(), error: null });
    repo.executeRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await reconcilePendingEscrowReleases(repo);

    expect(mockReleaseLock).toHaveBeenCalledWith('escrow_lock:order-1', 'lock-token');
    expect(mockReleaseLock).toHaveBeenCalledWith(GLOBAL_LOCK_KEY, 'lock-token');
  });
});

describe('timer lifecycle', () => {
  it('sets an interval timer when startEscrowReleaseReconciliation is called', () => {
    const originalSetInterval = global.setInterval;
    const mockSetInterval = vi.fn((fn, ms) => originalSetInterval(fn, ms));
    global.setInterval = mockSetInterval;

    startEscrowReleaseReconciliation(makeOrderRepositoryMock());
    stopEscrowReleaseReconciliation();

    expect(mockSetInterval).toHaveBeenCalled();
    global.setInterval = originalSetInterval;
  });

  it('clears the interval timer when stopEscrowReleaseReconciliation is called', () => {
    const originalClearInterval = global.clearInterval;
    const mockClearInterval = vi.fn();
    global.clearInterval = mockClearInterval;

    startEscrowReleaseReconciliation(makeOrderRepositoryMock());
    stopEscrowReleaseReconciliation();

    expect(mockClearInterval).toHaveBeenCalled();
    global.clearInterval = originalClearInterval;
  });
});
