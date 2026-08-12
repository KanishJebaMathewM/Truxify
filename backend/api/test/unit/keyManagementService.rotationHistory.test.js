import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Bounded rotation-history read (issue #9230): getKeyRotationHistory must
// apply a .limit() so a wallet with many rotations does not return an
// unbounded payload / unbounded DB read on every call. Mirrors the bounded
// sibling keyRotationService.getRotationHistory (default limit 10).
// ---------------------------------------------------------------------------

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: vi.fn(async (_name, fn) => fn()),
}));

// Chainable supabase stub that records the terminal call chain.
let lastLimitArg = undefined;
let resolveWith = { data: [], error: null };

function chainable() {
  const chain = {};
  const methods = ['from', 'select', 'eq', 'order'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.limit = vi.fn((n) => {
    lastLimitArg = n;
    return chain;
  });
  // The query is awaited; make the chain thenable.
  chain.then = (resolve) => Promise.resolve(resolveWith).then((r) => resolve(r));
  return chain;
}

// Mutable supabase holder shared between the test and the mocked db module.
// vi.mock factories are hoisted above `let` declarations, so we cannot close
// over a test-scope variable directly; instead the factory returns an object
// whose `supabase` property the test reassigns.
const dbMock = { supabase: null, supabaseAdmin: null };
vi.mock('../../src/config/db.js', () => ({
  get supabase() {
    return dbMock.supabase;
  },
  get supabaseAdmin() {
    return dbMock.supabaseAdmin;
  },
}));

async function makeService() {
  vi.resetModules();
  const mod = await import('../../src/services/security/keyManagementService.js');
  return new mod.default();
}

describe('KeyManagementService.getKeyRotationHistory bounded read (#9230)', () => {
  beforeEach(() => {
    lastLimitArg = undefined;
    resolveWith = { data: [], error: null };
    dbMock.supabase = chainable();
  });

  it('applies a default limit of 10 (matching keyRotationService)', async () => {
    resolveWith = { data: [{ key_id: 'k1' }], error: null };
    const svc = await makeService();
    const out = await svc.getKeyRotationHistory('user-1', '0xabc');
    expect(lastLimitArg).toBe(10);
    expect(out).toEqual([{ key_id: 'k1' }]);
  });

  it('honours an explicit limit argument', async () => {
    const svc = await makeService();
    await svc.getKeyRotationHistory('user-1', '0xabc', 25);
    expect(lastLimitArg).toBe(25);
  });

  it('honours limit=1 for callers that only need the latest rotation', async () => {
    resolveWith = { data: [{ key_id: 'latest' }], error: null };
    const svc = await makeService();
    const out = await svc.getKeyRotationHistory('user-1', '0xabc', 1);
    expect(lastLimitArg).toBe(1);
    expect(out).toHaveLength(1);
  });

  it('still returns [] on a supabase error (no throw)', async () => {
    resolveWith = { data: null, error: { message: 'boom' } };
    const svc = await makeService();
    const out = await svc.getKeyRotationHistory('user-1', '0xabc');
    expect(out).toEqual([]);
    expect(lastLimitArg).toBe(10);
  });
});
