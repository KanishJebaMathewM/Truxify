import { describe, it, expect } from 'vitest';

/**
 * auditRoutes.js is statically imported by src/index.js and mounted at
 * /api/v1/admin/audit-logs. A duplicate `import logger` made it a SyntaxError,
 * which in ESM is raised at link time — so the whole API failed to boot, not
 * just this router.
 *
 * This pins the one property that failure violated: the module links and
 * exports a usable Express router.
 */
describe('auditRoutes module load', () => {
  it('links without a SyntaxError and default-exports an Express router', async () => {
    const mod = await import('../../src/routes/auditRoutes.js');

    expect(typeof mod.default).toBe('function');
    // Express routers are functions carrying a `stack` of layers.
    expect(Array.isArray(mod.default.stack)).toBe(true);
  });

  it('registers at least one route layer', async () => {
    const { default: router } = await import('../../src/routes/auditRoutes.js');

    const routeLayers = router.stack.filter((layer) => layer.route);
    expect(routeLayers.length).toBeGreaterThan(0);
  });
});
