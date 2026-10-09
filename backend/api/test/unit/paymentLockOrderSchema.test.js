import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const { state, client, release, deposit, noop } = vi.hoisted(() => {
  const state = { db: null };
  const client = { from: () => {
    let columns = '*';
    let field;
    let value;
    const query = {
      select: selection => { columns = selection; return query; },
      eq: (key, id) => { field = key; value = id; return query; },
      maybeSingle: async () => {
        // Execute the actual projection against PostgreSQL rather than handing
        // back a fixture that silently ignores nonexistent selected columns.
        const result = await state.db.query(`SELECT ${columns} FROM orders WHERE ${field} = $1`, [value]);
        return { data: result.rows[0] || null, error: null };
      },
    };
    return query;
  } };
  return { state, client, release: vi.fn(), deposit: vi.fn(), noop: (_req, _res, next) => next() };
});
vi.mock('../../src/core/container.js', async () => {
  const { OrderValidationService } = await import('../../src/services/order/orderValidationService.js');
  return { orderValidationService: new OrderValidationService({ supabase: client }),
    orderRepository: { findCustomerWallet: vi.fn(async () => ({ data: null })) } };
});
vi.mock('../../src/config/db.js', () => ({ createUserClient: () => client }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: noop }));
vi.mock('../../src/middleware/validate.js', () => ({ validateBody: () => noop, validateParams: () => noop }));
vi.mock('../../src/middleware/idempotency.js', () => ({ requireIdempotency: () => noop }));
vi.mock('../../src/middleware/auditLog.js', () => ({ auditLog: () => noop }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ createStore: () => null }));
vi.mock('express-rate-limit', () => ({ default: () => noop }));
vi.mock('../../src/lib/redisLock.js', () => ({ acquireLock: vi.fn(async () => 'owner-token'),
  releaseLock: release, LockAcquisitionError: class extends Error {} }));
vi.mock('../../src/services/escrow.js', () => ({
  recordDepositTx: deposit, getEscrowBookingId: () => 'booking', isEscrowEnabled: () => true,
  resolveExpectedDepositAmount: vi.fn(), submitEscrowRefund: vi.fn(), lockPayment: vi.fn(),
  paisaToMaticWei: vi.fn(), processMilestoneTransition: vi.fn(), executeEscrowTimeoutClawback: vi.fn(),
  ESCROW_MILESTONE_STATES: {},
}));
vi.mock('../../src/services/notificationService.js', () => ({ sendPushNotification: vi.fn() }));
vi.mock('../../src/utils/cacheInvalidation.js', () => ({ invalidateBookingCaches: vi.fn() }));
import paymentRoutes from '../../src/routes/paymentRoutes.js';
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const handler = paymentRoutes.stack.find(layer => layer.route?.path === '/lock').route.stack.at(-1).handle;

describe('payment lock order projection', () => {
  beforeAll(async () => {
    state.db = new PGlite();
    // Representative canonical order columns; customer wallets live on profiles,
    // not orders. No wallet_address column exists in this schema.
    await state.db.exec(`CREATE TABLE orders (
      id text PRIMARY KEY, order_display_id text, customer_id text, driver_id text,
      total_amount bigint, escrow_status text, escrow_booking_id text,
      escrow_driver_wallet text, escrow_amount_wei numeric, pending_bid_acceptance jsonb
    ); INSERT INTO orders VALUES ('order', 'TX-1', 'customer', 'driver', 10000,
      'funded', 'booking', NULL, 100, NULL);`);
  });
  afterAll(async () => { await state.db?.close(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    await state.db.exec("UPDATE orders SET escrow_status = 'funded'");
  });

  async function request(customerId = 'customer', orderId = 'order') {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    await handler({ body: { order_id: orderId, tx_hash: 'tx' }, user: { id: customerId } }, res);
    expect(release).toHaveBeenCalledWith(`payment_lock:${orderId}`, 'owner-token');
    expect(deposit).not.toHaveBeenCalled();
    return res;
  }

  it('returns the funded idempotent response through the real order lookup', async () => {
    const res = await request();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Payment already locked in escrow.',
      escrow_status: 'funded', order_display_id: 'TX-1' });
  });
  it('still denies another customer access to the order', async () => {
    expect((await request('other')).status).toHaveBeenCalledWith(403);
  });
  for (const status of ['released', 'refunded']) {
    it(`retains the ${status} funding guard`, async () => {
      await state.db.query('UPDATE orders SET escrow_status = $1', [status]);
      expect((await request()).status).toHaveBeenCalledWith(409);
    });
  }
  it('missing orders still return 404', async () => {
    expect((await request('customer', 'missing')).status).toHaveBeenCalledWith(404);
  });
  it('a funding order still requires the authoritative customer wallet', async () => {
    await state.db.exec("UPDATE orders SET escrow_status = 'funding'");
    expect((await request()).status).toHaveBeenCalledWith(422);
  });
});
