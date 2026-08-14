import { describe, it, expect } from 'vitest';

describe('middleware/index.js barrel exports', () => {
  it('exports requestIdMiddleware from requestId.js', async () => {
    const mod = await import('../../../src/middleware/index.js');
    expect(typeof mod.requestIdMiddleware).toBe('function');
  });

  it('exports requestLogger from requestId.js', async () => {
    const mod = await import('../../../src/middleware/index.js');
    expect(typeof mod.requestLogger).toBe('function');
  });

  it('exports addTracingHeaders from requestId.js', async () => {
    const mod = await import('../../../src/middleware/index.js');
    expect(typeof mod.addTracingHeaders).toBe('function');
  });

  it('exports securityHeaders as default', async () => {
    const mod = await import('../../../src/middleware/index.js');
    expect(typeof mod.securityHeaders).toBe('function');
  });

  it('exports requirePolicy from requirePolicy.js', async () => {
    const mod = await import('../../../src/middleware/index.js');
    expect(typeof mod.requirePolicy).toBe('function');
  });

  it('exports authenticate and requireRole from auth.js', async () => {
    const mod = await import('../../../src/middleware/index.js');
    expect(typeof mod.authenticate).toBe('function');
    expect(typeof mod.requireRole).toBe('function');
  });

  it('exports requireIdempotency from idempotency.js', async () => {
    const mod = await import('../../../src/middleware/index.js');
    expect(typeof mod.requireIdempotency).toBe('function');
  });
});
