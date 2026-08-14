import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ builder: null }));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn(() => state.builder) },
  supabaseAdmin: null,
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: vi.fn(async (_name, fn) => fn()),
}));

/** Thenable supabase query-builder mock that resolves to the given result. */
function mockQuery(result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
  };
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

describe('KeyManagementService', () => {
  let KeyManagementService;

  beforeEach(async () => {
    vi.resetModules();
    ({ default: KeyManagementService } = await import('../../src/services/security/keyManagementService.js'));
  });

  it('derives distinct keys for secrets sharing the same first 8 hex chars', async () => {
    const svc = new KeyManagementService();
    const secretA = `${'aaaa0000'}${'f'.repeat(56)}`;
    const secretB = `${'aaaa0000'}${'e'.repeat(56)}`;

    const keyA = await svc.deriveDeviceEncryptionKey('dev-1', secretA);
    const keyB = await svc.deriveDeviceEncryptionKey('dev-1', secretB);

    expect(keyA.equals(keyB)).toBe(false);
  });

  it('still caches derivations for the same device + secret', async () => {
    const svc = new KeyManagementService();
    const secret = 'c'.repeat(64);

    const first = await svc.deriveDeviceEncryptionKey('dev-1', secret);
    const second = await svc.deriveDeviceEncryptionKey('dev-1', secret);

    expect(first).toBe(second);
  });

  it('does not share a cached key across different secrets with an 8-char prefix', async () => {
    const svc = new KeyManagementService();
    const secretA = `${'beef0000'}${'a'.repeat(56)}`;
    const secretB = `${'beef0000'}${'b'.repeat(56)}`;

    const keyA = await svc.deriveDeviceEncryptionKey('dev-1', secretA);
    const keyB = await svc.deriveDeviceEncryptionKey('dev-1', secretB);

    expect(keyA.equals(keyB)).toBe(false);
  });

  it('bounds the rotation history to the default page size', async () => {
    const rows = [
      { key_id: 'k-2', created_at: '2026-08-10T10:00:00Z' },
      { key_id: 'k-1', created_at: '2026-08-09T10:00:00Z' },
    ];
    const builder = mockQuery({ data: rows, error: null });
    state.builder = builder;

    const svc = new KeyManagementService();
    const history = await svc.getKeyRotationHistory('user-1', 'wallet-1');

    expect(history).toEqual(rows);
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(10);
  });

  it('passes through an explicit limit', async () => {
    const builder = mockQuery({ data: [{ key_id: 'k-1' }], error: null });
    state.builder = builder;

    const svc = new KeyManagementService();
    await svc.getKeyRotationHistory('user-1', 'wallet-1', 25);

    expect(builder.limit).toHaveBeenCalledWith(25);
  });

  it('returns an empty array on a fetch error', async () => {
    state.builder = mockQuery({ data: null, error: new Error('db down') });

    const svc = new KeyManagementService();
    const history = await svc.getKeyRotationHistory('user-1', 'wallet-1');

    expect(history).toEqual([]);
  });
});
