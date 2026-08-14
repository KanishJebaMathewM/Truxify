import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db.js', () => ({
  get supabase() { return { name: 'supabase' }; },
  get supabaseAdmin() { return { name: 'supabase-admin' }; },
  get redisClient() { return null; },
  get mongoDb() { return null; },
  get firebaseAdmin() { return null; },
}));

vi.mock('../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/core/performanceMetrics.js', () => ({
  measureExecution: (name, fn) => fn(),
}));

vi.mock('../src/services/escrow.js', () => ({
  escrowRelease: vi.fn(),
  resolveExpectedDepositAmount: (order) => {
    if (order?.escrow_amount_wei != null) {
      return { expectedAmountWei: BigInt(order.escrow_amount_wei) };
    }
    if (order?.pending_bid_acceptance?.bid_amount != null) {
      return { expectedAmountWei: BigInt(order.pending_bid_acceptance.bid_amount) * 4000000000000n };
    }
    return { error: 'no amount on file', code: 'ESCROW_AMOUNT_MISSING' };
  },
  paisaToMaticWei: (paisa) => BigInt(Math.round(Number(paisa))) * 4000000000000n,
  weiWithinTolerance: (a, b, toleranceWei = 1000000000n) => {
    const diff = BigInt(a) > BigInt(b) ? BigInt(a) - BigInt(b) : BigInt(b) - BigInt(a);
    return diff <= BigInt(toleranceWei);
  },
}));

const { DeliveryVerificationService } = await import(
  '../src/services/order/deliveryVerificationService.js'
);

const ORDER = {
  id: 'order-1',
  order_display_id: 'OD-1',
  driver_id: 'driver-1',
  customer_id: 'customer-1',
  escrow_status: 'funded',
  escrow_release_attempts: 0,
  status: 'arriving',
  release_tx_hash: null,
  drop_lat: 19.076,
  drop_lng: 72.877,
  toll_estimate: 0,
  base_freight: 50000,
  platform_fee: 5000,
  total_amount: 55000,
};

function makeOrderRepository() {
  let readCount = 0;
  return {
    findOrderById: () => {
      readCount++;
      if (readCount === 1) {
        return Promise.resolve({ data: ORDER, error: null });
      }
      // post-RPC verification read
      return Promise.resolve({
        data: { status: 'payment_released', escrow_status: 'released', escrow_release_attempts: 1 },
        error: null,
      });
    },
    updateOrderGuardStatus: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
    executeRpc: vi.fn().mockResolvedValue({ data: { driver_id: 'driver-1', order_display_id: 'OD-1' }, error: null }),
    updateOrder: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
    updateWalletTransaction: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

function makeService({ escrowReleaseFn } = {}) {
  return new DeliveryVerificationService(null, {
    notificationService: {
      getActiveDeliveryOtp: () => Promise.resolve({ id: 'otp-1' }),
      verifyDeliveryOtpHash: () => true,
      verifyDeliveryOtp: () => Promise.resolve(true),
      storeDeliveryOtp: () => Promise.resolve(true),
      sendDeliveryOtpNotification: () => Promise.resolve({ success: true }),
    },
    escrowReleaseFn,
    trackingTokenService: null,
  });
}

describe('verifyDelivery escrow-before-RPC ordering (issue #4996)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases escrow first and passes the resulting tx hash to complete_trip_tx', async () => {
    const releaseOrder = [];
    const releaseFn = vi.fn().mockImplementation(() => {
      releaseOrder.push('release');
      return Promise.resolve({ txHash: '0xRELEASE', alreadyReleased: false });
    });
    const repo = makeOrderRepository();
    repo.executeRpc.mockImplementation(() => {
      releaseOrder.push('rpc');
      return Promise.resolve({ data: { driver_id: 'driver-1', order_display_id: 'OD-1' }, error: null });
    });

    const svc = makeService({ escrowReleaseFn: releaseFn });
    svc.orderRepository = repo;
    svc.assertDriverAtDropoff = vi.fn().mockResolvedValue();

    const result = await svc.verifyDelivery(
      { orderId: 'order-1', driverId: 'driver-1', otp: '123456' },
      {},
    );

    expect(releaseOrder).toEqual(['release', 'rpc']);
    expect(repo.executeRpc).toHaveBeenCalledWith(
      'complete_trip_tx',
      expect.objectContaining({ p_release_tx_hash: '0xRELEASE' }),
      expect.anything(),
    );
    // The confirmed release outcome is persisted before the RPC runs so a
    // later RPC failure is recoverable.
    expect(repo.updateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ escrow_status: 'released', release_tx_hash: '0xRELEASE' }),
    );
    expect(result).toEqual({ escrowUpdateFailed: false });
  });

  it('does not call complete_trip_tx when the on-chain release fails (retryable 503)', async () => {
    const repo = makeOrderRepository();
    const svc = makeService({
      escrowReleaseFn: () => Promise.reject(new Error('on-chain timeout')),
    });
    svc.orderRepository = repo;
    svc.assertDriverAtDropoff = vi.fn().mockResolvedValue();

    await expect(
      svc.verifyDelivery({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }, {}),
    ).rejects.toMatchObject({ status: 503, payload: { retryable: true } });

    expect(repo.executeRpc).not.toHaveBeenCalled();
  });

  it('is idempotent when the release already completed (alreadyReleased)', async () => {
    const repo = makeOrderRepository();
    const svc = makeService({
      escrowReleaseFn: () =>
        Promise.resolve({ txHash: null, alreadyReleased: true }),
    });
    svc.orderRepository = repo;
    svc.assertDriverAtDropoff = vi.fn().mockResolvedValue();

    const result = await svc.verifyDelivery(
      { orderId: 'order-1', driverId: 'driver-1', otp: '123456' },
      {},
    );

    expect(repo.executeRpc).toHaveBeenCalled();
    expect(repo.executeRpc.mock.calls[0][1].p_release_tx_hash).toBe(null);
    expect(repo.updateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ escrow_status: 'released' }),
    );
    expect(result.escrowUpdateFailed).toBe(false);
  });

  it('routes all release-path writes through the service-role admin repository', async () => {
    const readRepo = makeOrderRepository();
    const adminRepo = {
      updateOrder: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
      updateOrderGuardStatus: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
      updateWalletTransaction: vi.fn().mockResolvedValue({ data: null, error: null }),
      executeRpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const releaseFn = vi.fn().mockResolvedValue({ txHash: '0xADMIN' });

    const svc = makeService({ escrowReleaseFn: releaseFn });
    svc.orderRepository = readRepo;
    svc.adminOrderRepository = adminRepo;
    svc.assertDriverAtDropoff = vi.fn().mockResolvedValue();

    const result = await svc.verifyDelivery(
      { orderId: 'order-1', driverId: 'driver-1', otp: '123456' },
      {},
    );

    // Release evidence persisted via the admin (service_role) repository
    expect(adminRepo.updateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ escrow_status: 'released', release_tx_hash: '0xADMIN' }),
    );
    // Guard update and wallet description also on the admin repo
    expect(adminRepo.updateOrderGuardStatus).toHaveBeenCalled();
    expect(adminRepo.updateWalletTransaction).toHaveBeenCalled();
    // The RPC itself goes through the read repository with the admin client
    // (executeRpc requires an explicit per-call client); the admin repo never
    // executes it, and reads (order lookup, post-RPC verification) stay on the
    // user repo.
    expect(adminRepo.executeRpc).not.toHaveBeenCalled();
    expect(readRepo.executeRpc).toHaveBeenCalledWith(
      'complete_trip_tx',
      expect.objectContaining({ p_release_tx_hash: '0xADMIN' }),
      expect.anything(),
    );
    expect(result.escrowUpdateFailed).toBe(false);
  });
});

describe('verifyDelivery payout defense-in-depth (amount integrity)', () => {
  const EXPECTED_WEI = 220000000000000000n; // 55000 paisa × 4e12

  function makeFundedOrder(overrides = {}) {
    return {
      ...ORDER,
      escrow_amount_wei: EXPECTED_WEI.toString(),
      pending_bid_acceptance: { bid_amount: 55000 },
      ...overrides,
    };
  }

  function makeRepo(order = makeFundedOrder()) {
    let readCount = 0;
    return {
      findOrderById: () => {
        readCount++;
        if (readCount === 1) return Promise.resolve({ data: order, error: null });
        return Promise.resolve({
          data: { status: 'payment_released', escrow_status: 'released', escrow_release_attempts: 1 },
          error: null,
        });
      },
      updateOrderGuardStatus: vi.fn().mockResolvedValue({ data: { id: order.id }, error: null }),
      executeRpc: vi.fn().mockResolvedValue({ data: { driver_id: 'driver-1', order_display_id: 'OD-1' }, error: null }),
      updateOrder: vi.fn().mockResolvedValue({ data: { id: order.id }, error: null }),
      updateWalletTransaction: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
  }

  function makeService({ escrowReleaseFn, repo }) {
    const svc = new DeliveryVerificationService(null, {
      notificationService: {
        getActiveDeliveryOtp: () => Promise.resolve({ id: 'otp-1' }),
        verifyDeliveryOtpHash: () => true,
        verifyDeliveryOtp: () => Promise.resolve(true),
        storeDeliveryOtp: () => Promise.resolve(true),
        sendDeliveryOtpNotification: () => Promise.resolve({ success: true }),
      },
      escrowReleaseFn,
      trackingTokenService: null,
    });
    svc.orderRepository = repo;
    svc.assertDriverAtDropoff = vi.fn().mockResolvedValue();
    return svc;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the authoritative expected amount to escrowReleaseFn for on-chain verification', async () => {
    const repo = makeRepo();
    const releaseFn = vi.fn().mockResolvedValue({ txHash: '0xRELEASE' });
    const svc = makeService({ escrowReleaseFn: releaseFn, repo });

    await svc.verifyDelivery({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }, {});

    expect(releaseFn).toHaveBeenCalledWith('OD-1', EXPECTED_WEI);
  });

  it('blocks the release when escrow_amount_wei is inconsistent with total_amount', async () => {
    const repo = makeRepo(makeFundedOrder({ escrow_amount_wei: '1000000000000000' }));
    const releaseFn = vi.fn().mockResolvedValue({ txHash: '0xRELEASE' });
    const svc = makeService({ escrowReleaseFn: releaseFn, repo });

    await expect(
      svc.verifyDelivery({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }, {}),
    ).rejects.toMatchObject({
      status: 409,
      payload: { code: 'ESCROW_AMOUNT_MISMATCH' },
    });

    expect(releaseFn).not.toHaveBeenCalled();
    expect(repo.executeRpc).not.toHaveBeenCalled();
    expect(repo.updateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({
        escrow_status: 'release_failed',
        escrow_release_error: expect.stringContaining('ESCROW_AMOUNT_MISMATCH'),
      }),
    );
  });

  it('treats an on-chain amount mismatch from escrowReleaseFn as a terminal 409, not a retryable 503', async () => {
    const repo = makeRepo();
    const releaseFn = vi.fn().mockResolvedValue({
      txHash: null,
      error: 'On-chain booking amount does not match',
      code: 'DEPOSIT_AMOUNT_MISMATCH',
    });
    const svc = makeService({ escrowReleaseFn: releaseFn, repo });

    await expect(
      svc.verifyDelivery({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }, {}),
    ).rejects.toMatchObject({
      status: 409,
      payload: { code: 'DEPOSIT_AMOUNT_MISMATCH', retryable: false },
    });

    expect(repo.executeRpc).not.toHaveBeenCalled();
  });

  it('still releases when the stored amount is within tolerance of total_amount (legacy float rounding)', async () => {
    const legacyWei = (EXPECTED_WEI + 256n).toString();
    const repo = makeRepo(makeFundedOrder({ escrow_amount_wei: legacyWei }));
    const releaseFn = vi.fn().mockResolvedValue({ txHash: '0xRELEASE' });
    const svc = makeService({ escrowReleaseFn: releaseFn, repo });

    const result = await svc.verifyDelivery({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }, {});

    expect(releaseFn).toHaveBeenCalledWith('OD-1', BigInt(legacyWei));
    expect(result).toEqual({ escrowUpdateFailed: false });
  });
});

describe('verifyDelivery stuck-escrow retry release confirmation (issue #7732)', () => {
  function makeRetryService({ escrowReleaseFn, order = {} }) {
    const repo = {
      findOrderById: vi.fn().mockResolvedValue({
        data: {
          ...ORDER,
          status: 'payment_released',
          escrow_status: 'funded',
          ...order,
        },
        error: null,
      }),
      updateOrderGuardStatus: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
      executeRpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      updateOrder: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
      updateWalletTransaction: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const notificationService = {
      getActiveDeliveryOtp: () => Promise.resolve({ id: 'otp-1' }),
      verifyDeliveryOtpHash: () => true,
      verifyDeliveryOtp: vi.fn().mockResolvedValue(true),
      storeDeliveryOtp: () => Promise.resolve(true),
      sendDeliveryOtpNotification: () => Promise.resolve({ success: true }),
    };
    const svc = new DeliveryVerificationService(null, {
      notificationService,
      escrowReleaseFn,
      trackingTokenService: { revokeAllForOrder: vi.fn().mockResolvedValue() },
    });
    svc.orderRepository = repo;
    return { svc, repo, notificationService };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aborts with a retryable 503 and records the failure when the on-chain release is not confirmed on retry', async () => {
    const { svc, repo } = makeRetryService({
      escrowReleaseFn: () => Promise.resolve({ txHash: null, alreadyReleased: false }),
    });

    await expect(
      svc.verifyDelivery({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }, {}),
    ).rejects.toMatchObject({ status: 503, payload: { retryable: true } });

    expect(repo.updateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({
        escrow_release_error: expect.stringContaining('no transaction hash'),
      }),
    );
    expect(repo.executeRpc).not.toHaveBeenCalled();
  });

  it('does not revoke tracking tokens or notify when the retry release is not confirmed', async () => {
    const trackingTokenService = { revokeAllForOrder: vi.fn().mockResolvedValue() };
    const notificationService = {
      getActiveDeliveryOtp: () => Promise.resolve({ id: 'otp-1' }),
      verifyDeliveryOtpHash: () => true,
      verifyDeliveryOtp: vi.fn().mockResolvedValue(true),
      storeDeliveryOtp: () => Promise.resolve(true),
      sendDeliveryOtpNotification: () => Promise.resolve({ success: true }),
    };
    const repo = {
      findOrderById: vi.fn().mockResolvedValue({
        data: { ...ORDER, status: 'payment_released', escrow_status: 'release_failed' },
        error: null,
      }),
      updateOrder: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
      updateOrderGuardStatus: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null }),
      executeRpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      updateWalletTransaction: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const svc = new DeliveryVerificationService(null, {
      notificationService,
      escrowReleaseFn: () => Promise.resolve({ txHash: null, error: 'release reverted' }),
      trackingTokenService,
    });
    svc.orderRepository = repo;

    await expect(
      svc.verifyDelivery({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }, {}),
    ).rejects.toMatchObject({ status: 503, payload: { retryable: true } });

    expect(trackingTokenService.revokeAllForOrder).not.toHaveBeenCalled();
  });

  it('consumes the OTP only after a confirmed release on the retry path', async () => {
    const { svc, notificationService } = makeRetryService({
      escrowReleaseFn: () => Promise.resolve({ txHash: '0xRETRY', alreadyReleased: false }),
    });

    const result = await svc.verifyDelivery(
      { orderId: 'order-1', driverId: 'driver-1', otp: '123456' },
      {},
    );

    expect(result).toEqual({ escrowUpdateFailed: false });
    expect(notificationService.verifyDeliveryOtp).toHaveBeenCalledWith('otp-1');
  });

  it('blocks the trip-completion RPC when escrow was never funded', async () => {
    const { svc, repo } = makeRetryService({
      order: { status: 'arriving', escrow_status: 'pending' },
      escrowReleaseFn: () => Promise.resolve({ txHash: '0xSHOULD-NOT-RUN' }),
    });
    svc.assertDriverAtDropoff = vi.fn().mockResolvedValue();

    await expect(
      svc.verifyDelivery({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }, {}),
    ).rejects.toMatchObject({ status: 503, payload: { retryable: true } });

    expect(repo.executeRpc).not.toHaveBeenCalled();
    expect(repo.updateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({
        escrow_release_error: expect.stringContaining('ESCROW_NOT_RELEASED'),
      }),
    );
  });
});
