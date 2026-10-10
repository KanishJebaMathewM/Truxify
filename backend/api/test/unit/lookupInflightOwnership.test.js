import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mocks.from }, redisClient: null,
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn() },
}));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

describe.each(['/vehicle-types', '/regions'])('lookup ownership on %s', path => {
  let call;
  let pending;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mocks.from.mockReset();
    pending = [];
    mocks.from.mockImplementation(() => ({ select: () => {
      const query = deferred();
      pending.push(query);
      return query.promise;
    } }));
    const { default: router } = await import('../../src/routes/lookupRoutes.js');
    const handler = router.stack.find(layer => layer.route?.path === path).route.stack[0].handle;
    call = () => {
      const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      return { response, done: handler({ requestId: 'test' }, response) };
    };
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('does not let a completed request deadline evict its pending replacement', async () => {
    const first = call();
    await vi.advanceTimersByTimeAsync(10000);
    pending[0].resolve({ data: null, error: { message: 'retryable failure' } });
    await first.done;
    const second = call();
    await vi.advanceTimersByTimeAsync(20000);
    const third = call();
    const reads = mocks.from.mock.calls.length;
    for (const query of pending) query.resolve({ data: [{ id: 'new' }], error: null });
    await Promise.all([second.done, third.done]);
    expect(reads).toBe(2);
    expect(second.response.json).toHaveBeenCalledWith({ data: [{ id: 'new' }] });
    expect(third.response.json).toHaveBeenCalledWith({ data: [{ id: 'new' }] });
  });

  it('does not let expired request waiters remove a pending replacement', async () => {
    const first = call();
    const firstWaiter = call();
    await vi.advanceTimersByTimeAsync(30000);
    const replacement = call();
    pending[0].resolve({ data: null, error: { message: 'late failure' } });
    await Promise.all([first.done, firstWaiter.done]);
    const replacementWaiter = call();
    const reads = mocks.from.mock.calls.length;
    for (const query of pending) query.resolve({ data: [{ id: 'replacement' }], error: null });
    await Promise.all([replacement.done, replacementWaiter.done]);
    expect(reads).toBe(2);
    expect(replacementWaiter.response.json).toHaveBeenCalledWith({ data: [{ id: 'replacement' }] });
  });

  it('still allows retry after the active owner exceeds the existing deadline', async () => {
    const first = call();
    await vi.advanceTimersByTimeAsync(30000);
    const second = call();
    expect(mocks.from).toHaveBeenCalledTimes(2);
    for (const query of pending) query.resolve({ data: [], error: null });
    await Promise.all([first.done, second.done]);
  });
});
