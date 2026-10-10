/**
 * orderController must use the order services wired in core/container.js.
 *
 * It used to build its own copies: an OrderRepository on the anon-key
 * `supabase` client (no session, so orders RLS returns zero rows) and an
 * OrderTimelineService handed `{ supabase, logger }` where a repository belongs
 * (so creating an order died on `createTimeline is not a function` after the
 * order row was already written).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');

// The anon client sees nothing, the way orders RLS treats a session-less request.
const anon = createSupabaseMock();
// The service-role client sees the rows.
const admin = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: anon.supabase,
  supabaseAdmin: admin.supabase,
  createUserClient: () => anon.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

vi.mock('../../src/services/osrm.js', async () => ({
  ...(await vi.importActual('../../src/services/osrm.js')),
  getRouteEstimate: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/ml.js', () => ({
  predictDemand: vi.fn(),
  predictPrice: vi.fn().mockResolvedValue({ estimatedPricePaisa: null }),
}));

const { createOrder, getOrderDetails } = await import('../../src/controllers/orderController.js');

const CUSTOMER_ID = '00000000-0000-0000-0000-000000000abc';

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const validOrderBody = {
  pickup_address: '123 Pickup St, Mumbai',
  pickup_lat: 19.076,
  pickup_lng: 72.8777,
  drop_address: '456 Drop Ave, Delhi',
  drop_lat: 28.7041,
  drop_lng: 77.1025,
  pickup_date: '2026-10-10',
  pickup_time: '09:00',
  goods_type: 'electronics',
  weight_tonnes: 10,
};

describe('orderController service wiring', () => {
  beforeEach(() => {
    for (const client of [anon, admin]) {
      client.store.orders = [];
      client.store.order_timeline = [];
      client.store.load_offers = [];
      client.calls.length = 0;
    }
  });

  it('createOrder writes the order, its default timeline and the load offer', async () => {
    const res = mockRes();
    const next = vi.fn();

    await createOrder(
      { user: { id: CUSTOMER_ID, fullName: 'Test Customer' }, body: validOrderBody },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    const { order } = res.json.mock.calls[0][0];
    expect(order.order_display_id).toBeTruthy();

    expect(admin.store.orders).toHaveLength(1);
    const milestones = admin.store.order_timeline.filter(
      (row) => row.order_display_id === order.order_display_id
    );
    expect(milestones.map((row) => row.milestone)).toContain('Order Placed');
    expect(milestones).toHaveLength(8);
    expect(admin.store.load_offers).toHaveLength(1);
  });

  it('getOrderDetails reads through the service-role client, not the RLS-filtered anon client', async () => {
    admin.store.orders.push({
      id: '11111111-1111-1111-1111-111111111111',
      order_display_id: 'TRX-ABC123',
      customer_id: CUSTOMER_ID,
      driver_id: null,
      status: 'pending',
    });
    const res = mockRes();
    const next = vi.fn();

    await getOrderDetails(
      { user: { id: CUSTOMER_ID }, params: { id: '11111111-1111-1111-1111-111111111111' } },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ order: expect.objectContaining({ order_display_id: 'TRX-ABC123' }) })
    );
    expect(anon.calls).toHaveLength(0);
  });
});
