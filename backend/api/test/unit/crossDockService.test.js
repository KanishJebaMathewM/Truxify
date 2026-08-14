import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Module-level mocks ---------------------------------------------------
// supabaseAdmin is a builder: each chained call returns the same query object
// whose terminal methods (.single/.maybeSingle/.then) resolve to canned data.
const supabaseState = {};
function chainable(key, terminalKey = 'maybeSingle') {
  const obj = {
    select: vi.fn(() => obj),
    insert: vi.fn(() => obj),
    update: vi.fn(() => obj),
    rpc: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    in: vi.fn(() => obj),
    or: vi.fn(() => obj),
    order: vi.fn(() => obj),
    limit: vi.fn(() => obj),
    maybeSingle: vi.fn(() => {
      if (supabaseState[key] && 'maybeSingle' in supabaseState[key]) return Promise.resolve(supabaseState[key].maybeSingle);
      return Promise.resolve({ data: null, error: null });
    }),
    single: vi.fn(() => {
      if (supabaseState[key] && 'single' in supabaseState[key]) return Promise.resolve(supabaseState[key].single);
      return Promise.resolve({ data: null, error: null });
    }),
    then: undefined, // not used
  };
  // Allow `.then`-style consumption (await) to fall through to maybeSingle/single above.
  obj.then = (resolve, reject) => {
    if (supabaseState[key] && 'list' in supabaseState[key]) {
      return Promise.resolve(supabaseState[key].list).then(resolve, reject);
    }
    return Promise.resolve({ data: null, error: null }).then(resolve, reject);
  };
  return obj;
}

const fromMock = vi.fn((table) => chainable(table));
const rpcMock = vi.fn((name, args) => chainable('rpc:' + name));

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: { from: fromMock, rpc: rpcMock },
  isSupabaseConnected: () => true,
}));

const sendPushNotification = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification,
}));

vi.mock('../../src/lib/otpHashing.js', () => ({
  hashOtp: vi.fn((otp) => ({ hash: 'hash-' + otp, salt: 'salt-' + otp })),
  verifyOtpHash: vi.fn(() => true),
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: vi.fn((_name, fn) => fn()),
}));

describe('crossDockService', () => {
  let svc;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(supabaseState)) delete supabaseState[k];
    svc = await import('../../src/services/order/crossDockService.js');
  });

  describe('haversineKm', () => {
    it('returns ~0 for identical points', () => {
      expect(svc.haversineKm(0, 0, 0, 0)).toBeCloseTo(0, 5);
    });
    it('returns a positive distance for distinct points', () => {
      const d = svc.haversineKm(0, 0, 0, 1);
      expect(d).toBeGreaterThan(100);
      expect(d).toBeLessThan(120);
    });
  });

  describe('findHandoffCandidates', () => {
    it('rejects missing orderId', async () => {
      await expect(
        svc.findHandoffCandidates({ orderId: '', crossDockLat: 0, crossDockLng: 0 }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects invalid coordinates', async () => {
      await expect(
        svc.findHandoffCandidates({ orderId: 'o1', crossDockLat: 999, crossDockLng: 0 }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('calls the get_nearby_active_drivers RPC with the DDL param contract', async () => {
      await svc.findHandoffCandidates({ orderId: 'o1', crossDockLat: 19.076, crossDockLng: 72.8777, radiusKm: 50, limit: 20 });

      expect(rpcMock).toHaveBeenCalledWith('get_nearby_active_drivers', {
        origin_lat: 19.076,
        origin_lng: 72.8777,
        radius_meters: 50000,
        freshness_seconds: expect.any(Number),
      });
    });
  });

  describe('createTransferRequest', () => {
    it('rejects self-handoff', async () => {
      await expect(
        svc.createTransferRequest({ orderId: 'o1', fromDriverId: 'd1', toDriverId: 'd1', crossDockLat: 1, crossDockLng: 1 }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('404 when load does not exist', async () => {
      supabaseState.orders = { maybeSingle: { data: null, error: null } };
      await expect(
        svc.createTransferRequest({ orderId: 'o1', fromDriverId: 'd1', toDriverId: 'd2', crossDockLat: 1, crossDockLng: 1 }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('409 when load is not in transit', async () => {
      supabaseState.orders = { maybeSingle: { data: { id: 'o1', status: 'delivered', customer_id: 'c1' }, error: null } };
      await expect(
        svc.createTransferRequest({ orderId: 'o1', fromDriverId: 'd1', toDriverId: 'd2', crossDockLat: 1, crossDockLng: 1 }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('403 when from_driver does not own the active trip', async () => {
      supabaseState.orders = { maybeSingle: { data: { id: 'o1', status: 'in_transit', customer_id: 'c1' }, error: null } };
      supabaseState.trips = { maybeSingle: { data: { id: 't1', driver_id: 'dOther', status: 'in_progress' }, error: null } };
      await expect(
        svc.createTransferRequest({ orderId: 'o1', fromDriverId: 'd1', toDriverId: 'd2', crossDockLat: 1, crossDockLng: 1 }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('409 when an active transfer already exists', async () => {
      supabaseState.orders = { maybeSingle: { data: { id: 'o1', status: 'in_transit', customer_id: 'c1' }, error: null } };
      supabaseState.trips = { maybeSingle: { data: { id: 't1', driver_id: 'd1', status: 'in_progress' }, error: null } };
      supabaseState.cross_dock_transfers = { maybeSingle: { data: { id: 'x1', status: 'requested' }, error: null } };
      await expect(
        svc.createTransferRequest({ orderId: 'o1', fromDriverId: 'd1', toDriverId: 'd2', crossDockLat: 1, crossDockLng: 1 }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('creates a transfer and returns a handoff code', async () => {
      supabaseState.orders = { maybeSingle: { data: { id: 'o1', status: 'in_transit', customer_id: 'c1' }, error: null } };
      supabaseState.trips = { maybeSingle: { data: { id: 't1', driver_id: 'd1', status: 'in_progress' }, error: null } };
      // The "existing active transfer" lookup returns null; the insert uses .single()
      // We distinguish by table: first cross_dock_transfers call (maybeSingle) = null,
      // second cross_dock_transfers call (single via insert) = created row.
      // chainable() for cross_dock_transfers needs both maybeSingle and single.
      supabaseState.cross_dock_transfers = {
        maybeSingle: { data: null, error: null },
        single: { data: { id: 't-new', status: 'requested', from_driver_id: 'd1', to_driver_id: 'd2', order_id: 'o1' }, error: null },
      };
      const result = await svc.createTransferRequest({ orderId: 'o1', fromDriverId: 'd1', toDriverId: 'd2', crossDockLat: 1, crossDockLng: 1 });
      expect(result.id).toBe('t-new');
      expect(result.handoff_code).toMatch(/^\d{6}$/);
      expect(sendPushNotification).toHaveBeenCalledWith(
        'd2', expect.any(String), expect.any(String), 'cross_dock_request', expect.objectContaining({ transfer_id: 't-new' }),
      );
    });

    it('still succeeds if the push notification throws', async () => {
      sendPushNotification.mockRejectedValueOnce(new Error('push down'));
      supabaseState.orders = { maybeSingle: { data: { id: 'o1', status: 'in_transit', customer_id: 'c1' }, error: null } };
      supabaseState.trips = { maybeSingle: { data: { id: 't1', driver_id: 'd1', status: 'in_progress' }, error: null } };
      supabaseState.cross_dock_transfers = {
        maybeSingle: { data: null, error: null },
        single: { data: { id: 't-new', status: 'requested', from_driver_id: 'd1', to_driver_id: 'd2', order_id: 'o1' }, error: null },
      };
      const result = await svc.createTransferRequest({ orderId: 'o1', fromDriverId: 'd1', toDriverId: 'd2', crossDockLat: 1, crossDockLng: 1 });
      expect(result.id).toBe('t-new');
    });
  });

  describe('verifyHandoff', () => {
    it('400 when handoff code is missing', async () => {
      supabaseState.cross_dock_transfers = { maybeSingle: { data: null, error: null } };
      await expect(
        svc.verifyHandoff({ transferId: 't1', driverId: 'd2', handoffCode: '' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('404 when transfer is not found / not a participant', async () => {
      supabaseState.cross_dock_transfers = { maybeSingle: { data: null, error: null } };
      await expect(
        svc.verifyHandoff({ transferId: 't1', driverId: 'd2', handoffCode: '123456' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('403 when verifier is not the to_driver', async () => {
      supabaseState.cross_dock_transfers = {
        maybeSingle: { data: { id: 't1', from_driver_id: 'd1', to_driver_id: 'd2', status: 'accepted', otp_hash: 'h:s', expires_at: new Date(Date.now() + 1e9).toISOString(), otp_attempts: 0 }, error: null },
      };
      await expect(
        svc.verifyHandoff({ transferId: 't1', driverId: 'dOther', handoffCode: '123456' }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('409 when transfer is not accepted', async () => {
      supabaseState.cross_dock_transfers = {
        maybeSingle: { data: { id: 't1', from_driver_id: 'd1', to_driver_id: 'd2', status: 'requested', expires_at: new Date(Date.now() + 1e9).toISOString() }, error: null },
      };
      await expect(
        svc.verifyHandoff({ transferId: 't1', driverId: 'd2', handoffCode: '123456' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('declines after too many failed attempts', async () => {
      const { verifyOtpHash } = await import('../../src/lib/otpHashing.js');
      verifyOtpHash.mockReturnValueOnce(false);
      // Force the attempt counter to the threshold by seeding otp_attempts.
      supabaseState.cross_dock_transfers = {
        maybeSingle: { data: { id: 't1', from_driver_id: 'd1', to_driver_id: 'd2', status: 'accepted', otp_hash: 'h:s', expires_at: new Date(Date.now() + 1e9).toISOString(), otp_attempts: 4 }, error: null },
      };
      await expect(
        svc.verifyHandoff({ transferId: 't1', driverId: 'd2', handoffCode: '000000' }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('marks verified on a matching code', async () => {
      const { verifyOtpHash } = await import('../../src/lib/otpHashing.js');
      verifyOtpHash.mockReturnValueOnce(true);
      supabaseState.cross_dock_transfers = {
        maybeSingle: { data: { id: 't1', from_driver_id: 'd1', to_driver_id: 'd2', status: 'accepted', otp_hash: 'h:s', expires_at: new Date(Date.now() + 1e9).toISOString(), otp_attempts: 0 }, error: null },
        single: { data: { id: 't1', status: 'verified', from_driver_id: 'd1', to_driver_id: 'd2', order_id: 'o1', verified_at: '2026-01-01T00:00:00.000Z' }, error: null },
      };
      const result = await svc.verifyHandoff({ transferId: 't1', driverId: 'd2', handoffCode: '123456' });
      expect(result.status).toBe('verified');
    });
  });

  describe('acceptTransferRequest', () => {
    it('403 when non-to_driver tries to accept', async () => {
      supabaseState.cross_dock_transfers = {
        maybeSingle: { data: { id: 't1', from_driver_id: 'd1', to_driver_id: 'd2', status: 'requested', expires_at: new Date(Date.now() + 1e9).toISOString() }, error: null },
      };
      await expect(
        svc.acceptTransferRequest({ transferId: 't1', driverId: 'dOther' }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('409 when not in requested state', async () => {
      supabaseState.cross_dock_transfers = {
        maybeSingle: { data: { id: 't1', from_driver_id: 'd1', to_driver_id: 'd2', status: 'accepted', expires_at: new Date(Date.now() + 1e9).toISOString() }, error: null },
      };
      await expect(
        svc.acceptTransferRequest({ transferId: 't1', driverId: 'd2' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('410 when the accept window has expired', async () => {
      supabaseState.cross_dock_transfers = {
        maybeSingle: { data: { id: 't1', from_driver_id: 'd1', to_driver_id: 'd2', status: 'requested', expires_at: new Date(Date.now() - 1000).toISOString() }, error: null },
      };
      await expect(
        svc.acceptTransferRequest({ transferId: 't1', driverId: 'd2' }),
      ).rejects.toMatchObject({ status: 410 });
    });
  });

  describe('cancelTransferRequest', () => {
    it('403 when non-from_driver tries to cancel', async () => {
      supabaseState.cross_dock_transfers = {
        maybeSingle: { data: { id: 't1', from_driver_id: 'd1', to_driver_id: 'd2', status: 'requested', expires_at: new Date(Date.now() + 1e9).toISOString() }, error: null },
      };
      await expect(
        svc.cancelTransferRequest({ transferId: 't1', driverId: 'd2' }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('409 when trying to cancel a verified handoff', async () => {
      supabaseState.cross_dock_transfers = {
        maybeSingle: { data: { id: 't1', from_driver_id: 'd1', to_driver_id: 'd2', status: 'verified', expires_at: new Date(Date.now() + 1e9).toISOString() }, error: null },
      };
      await expect(
        svc.cancelTransferRequest({ transferId: 't1', driverId: 'd1' }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('listTransfers', () => {
    it('rejects missing driverId', async () => {
      await expect(svc.listTransfers({ driverId: '' })).rejects.toMatchObject({ status: 400 });
    });
    it('rejects an invalid status filter', async () => {
      await expect(svc.listTransfers({ driverId: 'd1', status: 'bogus' })).rejects.toMatchObject({ status: 400 });
    });
  });
});
