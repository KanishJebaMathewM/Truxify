import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: null,
  supabaseAdmin: null,
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: vi.fn(async (_name, fn) => fn()),
}));

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
});
