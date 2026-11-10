/**
 * Regression test: crossDockService.js must be loadable.
 *
 * origin/main opened the file's header block with a bare `**` instead of `/**`,
 * so the whole doc comment was parsed as code and the module raised a
 * SyntaxError. crossDockRoutes.js imports this file and is mounted at
 * /api/cross-dock, so the failure was a hard import-time error rather than a
 * runtime one.
 *
 * The strongest available assertion is that the module actually loads, so this
 * test imports it rather than pattern-matching the source. The comment-shape
 * assertions below pin the specific artifact so a future mangling of the header
 * is reported clearly instead of as an opaque parse error.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
    rpc: async () => ({ data: null, error: null }),
  },
  supabase: null,
  redisClient: null,
}));

const SERVICE_PATH = path.resolve(__dirname, '../../src/services/order/crossDockService.js');

describe('crossDockService module integrity', () => {
  it('loads without a SyntaxError', async () => {
    const mod = await import('../../src/services/order/crossDockService.js');
    expect(mod).toBeTruthy();
  });

  it('exposes the full cross-dock transfer lifecycle', async () => {
    const mod = await import('../../src/services/order/crossDockService.js');

    for (const fn of [
      'findHandoffCandidates',
      'createTransferRequest',
      'acceptTransferRequest',
      'declineTransferRequest',
      'cancelTransferRequest',
      'verifyHandoff',
      'getTransfer',
      'listTransfers',
    ]) {
      expect(typeof mod[fn], `${fn} should be exported as a function`).toBe('function');
    }
  });

  it('re-exports DomainError and haversineKm', async () => {
    const mod = await import('../../src/services/order/crossDockService.js');
    expect(mod.DomainError).toBeTruthy();
    expect(typeof mod.haversineKm).toBe('function');
  });

  it('starts with a well-formed block comment', () => {
    const source = fs.readFileSync(SERVICE_PATH, 'utf8');
    // A bare `**` opener leaves the doc comment parsed as code.
    expect(source.startsWith('/**')).toBe(true);
    expect(source.startsWith('**')).toBe(false);
  });

  it('closes the header comment before the first import', () => {
    const source = fs.readFileSync(SERVICE_PATH, 'utf8');
    const headerEnd = source.indexOf('*/');
    const firstImport = source.search(/^import /m);

    expect(headerEnd).toBeGreaterThan(-1);
    expect(firstImport).toBeGreaterThan(-1);
    // The comment must terminate before any statement, otherwise the header is
    // being executed as code.
    expect(headerEnd).toBeLessThan(firstImport);
  });
});