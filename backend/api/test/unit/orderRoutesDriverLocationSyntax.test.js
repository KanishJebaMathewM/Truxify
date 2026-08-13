/**
 * Syntax-gate regression test for GitHub issue #6662.
 *
 * The `GET /:id/driver-location` route in orderRoutes.js previously contained
 * a malformed, merged double-handler whose stray `);` made the module fail to
 * parse (API server would not boot):
 *
 *   node --check backend/api/src/routes/orderRoutes.js
 *   SyntaxError: Unexpected token ')'   (orderRoutes.js:1700)
 *
 * This test locks the fix in two complementary ways:
 *   1. Runs `node --check` on the module so a parse error fails CI.
 *   2. Extracts the full `router.get('/:id/driver-location', ...)` statement
 *      and asserts it contains exactly one async handler, so the reported
 *      merged double-handler cannot silently return.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeFile = path.resolve(__dirname, '../../src/routes/orderRoutes.js');

/** Extract the balanced `router.get('/:id/driver-location', ...)` call. */
function driverLocationCall(source) {
  const start = source.indexOf("router.get('/:id/driver-location'");
  expect(start, 'driver-location route definition not found').toBeGreaterThan(-1);

  let depth = 0;
  let i = start;
  for (; i < source.length; i++) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return { call: source.slice(start, i + 1), after: source[i + 1] };
}

describe('orderRoutes.js driver-location route syntax (issue #6662)', () => {
  it('module parses cleanly under `node --check`', () => {
    const result = spawnSync(process.execPath, ['--check', routeFile], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('driver-location route is a single balanced router.get call', () => {
    const source = readFileSync(routeFile, 'utf8');
    const { call, after } = driverLocationCall(source);

    // The stray `);` from the merged double-handler would have left the route
    // as a dangling comma-expression — the balanced call must be a standalone
    // statement terminated by `;`.
    expect(after, 'router.get call must be a complete statement').toBe(';');

    const handlerCount = (call.match(/async\s+\(req,\s*res\)/g) ?? []).length;
    expect(handlerCount, 'expected exactly one async handler').toBe(1);
  });

  it('middleware chain stays inside the router.get call', () => {
    const source = readFileSync(routeFile, 'utf8');
    const { call } = driverLocationCall(source);

    for (const piece of [
      "requirePolicy('order:view-driver-location')",
      'validateParams(paramIdSchema)',
      "async (req, res) =>",
    ]) {
      expect(call, `missing middleware/handler ${piece}`).toContain(piece);
    }
  });
});
