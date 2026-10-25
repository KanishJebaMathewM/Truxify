import { describe, it, expect, vi, beforeEach } from 'vitest';

const { anonFrom, adminFrom } = vi.hoisted(() => ({
  anonFrom: vi.fn(),
  adminFrom: vi.fn(),
}));

// `orders` and `delivery_otps` only grant SELECT to service_role/authenticated,
// so the anon key can never read them. The oracle performs those reads on
// behalf of the server and therefore has to use the service-role client.
vi.mock('../../src/config/db.js', () => ({
  supabase: { from: anonFrom },
  supabaseAdmin: { from: adminFrom },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/services/notificationService.js', () => ({
  verifyDeliveryOtpHash: vi.fn(() => true),
}));

vi.mock('../../src/services/order/deliveryVerificationService.js', () => ({
  DeliveryVerificationService: class {},
}));

import OracleService from '../../src/oracle/OracleService.js';

const ORDER_ID = '550e8400-e29b-41d4-a716-446655440000';

function createTableClient(rowsByTable) {
  return {
    from: vi.fn((table) => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({
          data: Object.prototype.hasOwnProperty.call(rowsByTable, table)
            ? rowsByTable[table]
            : null,
          error: null,
        })),
      };
      return builder;
    }),
  };
}

describe('OracleService client selection', () => {
  let service;
  let adminClient;

  beforeEach(() => {
    vi.clearAllMocks();

    // The anon key is blocked by RLS on both tables, so every read is empty.
    anonFrom.mockImplementation(() => {
      throw new Error('anon key cannot read orders');
    });

    adminClient = createTableClient({
      orders: {
        id: ORDER_ID,
        status: 'in_transit',
        otp_verified: false,
        blockchain_tx_hash: null,
        escrow_status: 'funded',
      },
      delivery_otps: {
        id: 'otp-1',
        otp_hash: 'hash',
        otp_salt: 'salt',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        verified: false,
      },
    });
    adminFrom.mockImplementation((table) => adminClient.from(table));

    service = new OracleService();
  });

  it('defaults to the service-role client', () => {
    expect(service.supabase.from).toBe(adminFrom);
  });

  it('reads orders and delivery OTPs through the service-role client', async () => {
    const result = await service.confirmDelivery({
      orderId: ORDER_ID,
      otp: '123456',
      gpsCoordinates: null,
    });

    expect(adminFrom).toHaveBeenCalledWith('orders');
    expect(adminFrom).toHaveBeenCalledWith('delivery_otps');
    expect(anonFrom).not.toHaveBeenCalled();
  });

  it('reaches the 2-of-3 provider consensus for an in-progress delivery', async () => {
    const result = await service.confirmDelivery({
      orderId: ORDER_ID,
      otp: '123456',
      gpsCoordinates: null,
    });

    // The OTP provider and the status provider confirm, GPS has no coordinates.
    expect(result.consensusCount).toBe(2);
    expect(result.confirmed).toBe(true);
  });

  it('keeps supporting an explicitly injected client', () => {
    const injected = createTableClient({});
    const injectedService = new OracleService({ supabase: injected });

    expect(injectedService.supabase).toBe(injected);
  });
});