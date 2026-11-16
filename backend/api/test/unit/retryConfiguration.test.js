import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  default: { startRetrySpan: vi.fn(() => ({ end: vi.fn() })) },
}));
vi.mock('../../src/core/telemetry/ContextPropagator.js', () => ({
  ContextPropagator: { snapshot: () => ({}), restore: (_snapshot, fn) => fn() },
}));
vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

describe('Supabase retry count configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('SUPABASE_RETRY_MAX_RETRIES', '3');
    vi.stubEnv('SUPABASE_RETRY_BASE_DELAY_MS', '1');
    vi.stubEnv('SUPABASE_RETRY_MAX_DELAY_MS', '10');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function exhaustedAttempts(options) {
    const { executeWithRetry } = await import('../../src/core/retry.js');
    const error = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    const operation = vi.fn().mockRejectedValue(error);
    // Attach a rejection handler before driving the fake clock.
    const result = executeWithRetry(operation, options).catch(caught => caught);
    await vi.runAllTimersAsync();
    expect(await result).toBe(error);
    return operation.mock.calls.length;
  }

  it.each(['invalid', '-1', '1.5', '2garbage', 'Infinity', '9007199254740992'])(
    'uses the default retry budget for invalid environment value %s', async value => {
      vi.stubEnv('SUPABASE_RETRY_MAX_RETRIES', value);
      expect(await exhaustedAttempts()).toBe(4);
    },
  );

  it.each([NaN, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, 'invalid'])(
    'uses the configured budget for invalid per-call count %s', async maxRetries => {
      vi.stubEnv('SUPABASE_RETRY_MAX_RETRIES', '2');
      expect(await exhaustedAttempts({ maxRetries })).toBe(3);
    },
  );

  it.each(['0', ' 2 ', ''])(
    'preserves valid or empty environment value %j', async value => {
      vi.stubEnv('SUPABASE_RETRY_MAX_RETRIES', value);
      expect(await exhaustedAttempts()).toBe(value.trim() === '' ? 4 : Number(value) + 1);
    },
  );

  it('preserves zero retries and an explicit valid override', async () => {
    expect(await exhaustedAttempts({ maxRetries: 0 })).toBe(1);
    expect(await exhaustedAttempts({ maxRetries: 2 })).toBe(3);
  });

  it('runs an actual repository write when environment configuration is invalid', async () => {
    vi.stubEnv('SUPABASE_RETRY_MAX_RETRIES', 'invalid');
    const { OrderRepository } = await import('../../src/repositories/orderRepository.js');
    const result = { data: { id: 'created-order' }, error: null };
    const query = { insert: vi.fn(), select: vi.fn(), single: vi.fn().mockResolvedValue(result) };
    query.insert.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const database = { from: vi.fn().mockReturnValue(query) };
    expect(await new OrderRepository(database).createOrder({ status: 'pending' })).toBe(result);
    expect(database.from).toHaveBeenCalledWith('orders');
    expect(query.single).toHaveBeenCalledTimes(1);
  });
});
