import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RedisStore } from 'rate-limit-redis';

const state = vi.hoisted(() => ({ status: 'ready', counts: new Map(), command: vi.fn() }));
vi.mock('../../src/config/db.js', () => ({ redisClient: {
  get status() { return state.status; }, call: state.command,
} }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const { __testing: { DeferredRedisStore } } = await import('../../src/middleware/rateLimiter.js');
let stores;

beforeEach(() => {
  stores = [];
  state.counts.clear();
  state.command.mockReset();
  state.command.mockImplementation(async (command, ...args) => {
    if (command === 'SCRIPT' && args[0] === 'LOAD') return 'loaded-script-sha';
    if (command === 'EVALSHA') {
      const key = args[2];
      const hits = (state.counts.get(key) || 0) + 1;
      state.counts.set(key, hits);
      return [hits, 60000];
    }
    throw new Error(`Unexpected Redis command: ${command}`);
  });
});
afterEach(() => { stores.forEach((store) => store.memoryStore.shutdown()); });

function create(prefix) {
  const store = new DeferredRedisStore(prefix);
  store.init({ windowMs: 60000 });
  stores.push(store);
  return store;
}

describe('healthy Redis promotion and shared counters', () => {
  it('uses the real RedisStore adapter and shares counts across two wrappers', async () => {
    const first = create('rl:shared:');
    const second = create('rl:shared:');
    expect(first.activeStore()).toBeInstanceOf(RedisStore);
    expect(second.activeStore()).toBeInstanceOf(RedisStore);
    expect((await first.increment('client-1')).totalHits).toBe(1);
    expect((await second.increment('client-1')).totalHits).toBe(2);
    expect(state.counts.get('rl:shared:client-1')).toBe(2);
  });

  it('preserves distinct limiter prefixes when using the same Redis client', async () => {
    const auth = create('rl:auth:');
    const bids = create('rl:bid:');
    expect((await auth.increment('client-1')).totalHits).toBe(1);
    expect((await bids.increment('client-1')).totalHits).toBe(1);
    expect([...state.counts.keys()].sort()).toEqual(['rl:auth:client-1', 'rl:bid:client-1']);
  });
});
