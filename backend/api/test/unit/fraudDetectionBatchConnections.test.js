/**
 * Unit tests for getBatchUserConnections pagination in FraudDetectionService
 *
 * Run with:  npm run test:unit -- test/unit/fraudDetectionBatchConnections.test.js
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
    range() {
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

describe('FraudDetectionService.getBatchUserConnections', () => {
  it('pages a batch past a full page and returns all connections', async () => {
    const fullPage = Array.from({ length: CONNECTION_PAGE_SIZE }, (_, i) => ({
      customer_id: 'user-1',
      driver_id: `driver-${i}`,
    }));
    const tailPage = [
      { customer_id: 'user-1', driver_id: 'tail-driver' },
      { customer_id: 'user-2', driver_id: 'driver-0' },
    ];

    vi.resetModules();
    const builder = buildOrdersBuilder([fullPage, tailPage]);
    const supabaseMock = mockDbWith(builder);

    const fraudDetection = (await import('../../src/services/fraud/FraudDetectionService.js')).default;

    const result = await fraudDetection.getBatchUserConnections(['user-1', 'user-2']);

    expect(supabaseMock.from).toHaveBeenCalledWith('orders');
    expect(result['user-1']).toContain('tail-driver');
    expect(result['user-1']).toContain('driver-999');
    expect(result['user-2']).toContain('driver-0');
  });

  it('stops paging a batch once fewer than a full page remains', async () => {
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

    const result = await fraudDetection.getBatchUserConnections(['user-1']);

    expect(ranges).toEqual([[0, CONNECTION_PAGE_SIZE - 1]]);
    expect(result['user-1']).toEqual([]);
  });
});
