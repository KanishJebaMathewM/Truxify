import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'supabase/migrations/20260806000000_rebalance_escrow_amount_wei_on_change_drop.sql',
);
const ROUTE_PATH = path.join(REPO_ROOT, 'backend/api/src/routes/orderRoutes.js');

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  getRouteEstimate: vi.fn(),
}));

vi.mock('../src/lib/redisLock.js', () => ({
  acquireLock: mocks.acquireLock,
  releaseLock: mocks.releaseLock,
}));

vi.mock('../src/config/db.js', () => ({
  get supabase() { return null; },
  get supabaseAdmin() { return null; },
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

vi.mock('../src/core/events/index.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), once: vi.fn() },
  EventBus: class {},
}));

vi.mock('../src/services/escrow.js', () => ({
  escrowRelease: vi.fn(),
  escrowRefund: vi.fn(),
  recordDepositTx: vi.fn(),
  submitEscrowRefund: vi.fn(),
  submitEscrowCancelWithPenalty: vi.fn(),
  confirmEscrowRefund: vi.fn(),
  getEscrowBookingId: vi.fn(),
  paisaToMaticWei: vi.fn((paisa) => BigInt(Math.round(paisa * 4e12))),
}));

vi.mock('../src/services/osrm.js', () => ({
  getRouteEstimate: (...args) => mocks.getRouteEstimate(...args),
}));

const { OrderLifecycleService } = await import(
  '../src/services/order/orderLifecycleService.js'
);

const BASE_ORDER = {
  id: 'order-1',
  order_display_id: 'OD-1',
  customer_id: 'customer-1',
  driver_id: null,
  status: 'pending',
  escrow_status: null,
  escrow_amount_wei: null,
  weight_tonnes: 2,
  pickup_lat: 19.0,
  pickup_lng: 72.8,
  pickup_address: 'Pune',
  drop_lat: 19.0,
  drop_lng: 72.8,
  drop_address: 'Old Drop',
};

function makeRepo(order = BASE_ORDER) {
  return {
    findOrderByAnyId: () => Promise.resolve({ data: { id: order.id }, error: null }),
    findOrderById: () => Promise.resolve({ data: order, error: null }),
    executeRpc: vi.fn().mockResolvedValue({
      data: { id: order.id, base_freight: 1, toll_estimate: 1, platform_fee: 1, total_amount: 1 },
      error: null,
    }),
  };
}

function makeService(repo) {
  return new OrderLifecycleService({
    orderRepository: repo,
    orderTimelineService: { insertEntry: vi.fn() },
    deliveryVerificationService: { verifyDelivery: vi.fn() },
  });
}

describe('changeDrop escrow rebalance (issue #5825)', () => {
  beforeEach(() => {
    mocks.acquireLock.mockReset();
    mocks.releaseLock.mockReset();
    mocks.getRouteEstimate.mockReset();
    mocks.acquireLock.mockResolvedValue('lock-owner-1');
    mocks.releaseLock.mockResolvedValue(true);
    mocks.getRouteEstimate.mockResolvedValue({ distanceKm: 500 });
  });

  it('sends an escrow_amount_wei matching the re-priced total to the RPC', async () => {
    const repo = makeRepo();
    const svc = makeService(repo);

    await svc.changeDrop(
      'order-1',
      'customer-1',
      { drop_address: 'Mumbai', drop_lat: 19.076, drop_lng: 72.877 },
      {},
    );

    const [name, params] = repo.executeRpc.mock.calls[0];
    expect(name).toBe('update_order_and_load_offer');
    const { total_amount, escrow_amount_wei } = params.p_order_updates;
    // escrow payout figure must track the advertised total via the canonical
    // paisa -> wei converter (wei = paisa * 4e12, see escrow.js paisaToMaticWei).
    expect(escrow_amount_wei).toBe(BigInt(Math.round(total_amount * 4e12)).toString());
  });

  it('rejects change-drop once escrow funding has started or completed', async () => {
    for (const escrow_status of ['funding', 'funded']) {
      const repo = makeRepo({ ...BASE_ORDER, escrow_status });
      const svc = makeService(repo);

      await expect(
        svc.changeDrop(
          'order-1',
          'customer-1',
          { drop_address: 'Mumbai', drop_lat: 19.076, drop_lng: 72.877 },
          {},
        ),
      ).rejects.toMatchObject({ status: 409 });

      expect(repo.executeRpc).not.toHaveBeenCalled();
    }
  });

  it('applies the escrow rebalance inside the per-order lock', async () => {
    const repo = makeRepo();
    const svc = makeService(repo);

    await svc.changeDrop(
      'order-1',
      'customer-1',
      { drop_address: 'Mumbai', drop_lat: 19.076, drop_lng: 72.877 },
      {},
    );

    expect(mocks.acquireLock).toHaveBeenCalledWith('escrow_lock:order-1', 30000);
    expect(mocks.releaseLock).toHaveBeenCalledWith('escrow_lock:order-1', 'lock-owner-1');
  });
});

describe('RPC/route persist escrow_amount_wei (issue #5825)', () => {
  it('the RPC migration writes escrow_amount_wei in the service_role branch', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain(
      "escrow_amount_wei = COALESCE(p_order_updates->>'escrow_amount_wei', escrow_amount_wei)",
    );
    // The key must be written alongside the other financial columns.
    expect(
      sql.indexOf('escrow_amount_wei = COALESCE(p_order_updates->'),
    ).toBeGreaterThan(sql.indexOf('total_amount  = COALESCE'));
  });

  it('the change-drop route handler rebalances escrow_amount_wei', () => {
    const src = fs.readFileSync(ROUTE_PATH, 'utf8');
    const changeDropSection = src.slice(
      src.indexOf("router.put('/:id/change-drop'"),
      src.indexOf('// ============================================================================\n// 16.'),
    );
    expect(changeDropSection).toContain('escrow_amount_wei: newAmountWei.toString()');
    expect(changeDropSection).toContain('BigInt(paisaToMaticWei(pricing.totalAmount))');
  });
});
