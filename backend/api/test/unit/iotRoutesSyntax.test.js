/**
 * Syntax-gate regression test for GitHub issue #8893.
 *
 * `backend/api/src/routes/iotRoutes.js` previously failed to parse — `node
 * --check` reported `SyntaxError: Unexpected token 'catch'` from a botched
 * merge around the `POST /telemetry/:id` handler: the `try`/`catch` blocks did
 * not balance (an orphaned `} catch`). The route is mounted at
 * `/api/iot` in the API entrypoint, so every IoT telemetry endpoint was
 * unavailable (500 at import/request time).
 *
 * This test locks the fix in place:
 *   1. Runs `node --check` on the module so a parse error fails CI.
 *   2. Asserts each telemetry handler has exactly one balanced `try {` /
 *      `catch (err)` pair, so the orphaned `} catch` cannot silently return.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeFile = path.resolve(__dirname, '../../src/routes/iotRoutes.js');

function occurrences(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

describe('iotRoutes.js syntax (issue #8893)', () => {
  it('module parses cleanly under `node --check`', () => {
    const result = spawnSync(process.execPath, ['--check', routeFile], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('each telemetry handler has exactly one balanced try/catch pair', () => {
    const source = readFileSync(routeFile, 'utf8');

    expect(occurrences(source, /try\s*\{/g), 'expected one try per handler').toBe(2);
    expect(occurrences(source, /catch\s*\(err\)\s*\{/g), 'each try needs a matching catch').toBe(2);
  });

  it('the module ends with the router export', () => {
    const source = readFileSync(routeFile, 'utf8');
    expect(source.trimEnd().endsWith('export default router;')).toBe(true);
  });
});
