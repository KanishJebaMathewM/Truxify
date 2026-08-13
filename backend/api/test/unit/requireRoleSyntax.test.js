/**
 * Regression tests for GitHub issue #6664.
 *
 * The role-denied branch of `requireRole` in backend/api/src/middleware/auth.js
 * previously contained an unclosed object literal followed by a second
 * `return`, which made the module fail to parse (API server would not boot):
 *
 *   node --check backend/api/src/middleware/auth.js
 *   SyntaxError: Unexpected token 'return'   (auth.js:495)
 *
 * This test locks the fix in two complementary ways:
 *   1. Runs `node --check` on the module so a parse error fails CI.
 *   2. Exercises `requireRole` directly and asserts the denied path produces a
 *      single, well-formed 403 JSON response and never calls `next()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.resolve(__dirname, '../../src/middleware/auth.js');

async function loadAuth() {
  vi.resetModules();
  vi.doMock('../../src/config/db.js', () => ({
    createUserClient: () => null,
    firebaseAdmin: null,
    supabase: null,
  }));
  return import('../../src/middleware/auth.js');
}

describe('auth.js requireRole (issue #6664)', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'false';
  });

  it('module parses cleanly under `node --check`', () => {
    const result = spawnSync(process.execPath, ['--check', authFile], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('rejects an unauthorized role with a single 403 JSON response', async () => {
    const { requireRole } = await loadAuth();

    const req = { user: { id: 'u1', role: 'customer' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await requireRole(['driver'])(req, res, next);

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Forbidden: Insufficient privileges.',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for an allowed role', async () => {
    const { requireRole } = await loadAuth();

    const req = { user: { id: 'u2', role: 'driver' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await requireRole(['driver'])(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing req.user with 401', async () => {
    const { requireRole } = await loadAuth();

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await requireRole(['driver'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });
});
