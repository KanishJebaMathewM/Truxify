/**
 * Unit tests for getUserConnections pagination in FraudDetectionService
 *
 * Run with:  npm run test:unit -- test/unit/fraudDetectionConnections.test.js
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const CONNECTION_PAGE_SIZE = 1000;

function buildOrdersBuilder(orderPages) {
  let index = 0;
  const builder = {
    select() { return this; },
    or() { return this; },
    order() { return this; },
    range(offset, end) {
      const page = orderPages[index++] ?? [];
      return Promise.resolve({ data: page, error: null });
    },
  };
  return builder;
}

function mockDbWith(builder, trace) {
  const from = vi.fn((table) => {
    if (trace) trace.from = table;
    return builder;
  });
  const supabaseAdminMock = { from };
  vi.doMock('../../src/config/db.js', () => ({
    supabaseAdmin: supabaseAdminMock,
    redisClient: {},
  }));
  return supabaseAdminMock;
}

afterEach(() => {
  vi.doUnmock('../../src/config/db.js');
});

describe('FraudDetectionService.getUserConnections', () => {
  it('pages past a full page of orders and dedupes connections', async () => {
    const fullPage = Array.from({ length: CONNECTION_PAGE_SIZE }, (_, i) => ({
      customer_id: i % 2 === 0 ? 'user-1' : `driver-${i}`,
      driver_id: i % 2 === 0 ? `driver-${i}` : 'user-1',
    }));
    const tailPage = [
      { customer_id: 'user-1', driver_id: 'tail-driver' },
      { customer_id: 'user-1', driver_id: 'driver-0' },
    ];

    vi.resetModules();
    const builder = buildOrdersBuilder([fullPage, tailPage]);
    const supabaseMock = mockDbWith(builder);

    const fraudDetection = (await import('../../src/services/fraud/FraudDetectionService.js')).default;

    const connections = await fraudDetection.getUserConnections('user-1');

    expect(supabaseMock.from).toHaveBeenCalledWith('orders');
    expect(connections).toContain('tail-driver');
    expect(connections).toContain('driver-0');
    expect(connections).toContain('driver-999');
  });

  it('stops paging once fewer than a full page remains', async () => {
    const ranges = [];
    const builder = {
      select() { return this; },
      or() { return this; },
      order() { return this; },
      range(offset, end) {
        ranges.push([offset, end]);
        return Promise.resolve({ data: [], error: null });
      },
    };

    vi.resetModules();
    mockDbWith(builder);

    const fraudDetection = (await import('../../src/services/fraud/FraudDetectionService.js')).default;

    const connections = await fraudDetection.getUserConnections('user-1');

    expect(ranges.length).toBe(1);
    expect(ranges[0]).toEqual([0, CONNECTION_PAGE_SIZE - 1]);
    expect(connections).toEqual([]);
  });
});
