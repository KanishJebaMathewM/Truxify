/**
 * Syntax-gate regression test for GitHub issue #6663.
 *
 * `backend/graphql/index.js` previously ended with a dangling promise-chain
 * continuation that made the module fail to parse (GraphQL gateway would not
 * boot):
 *
 *   startGraphQL();
 *   .catch(err => console.error("Promise.all failed:", err));
 *
 *   node --check backend/graphql/index.js
 *   SyntaxError: Unexpected token '.'   (graphql/index.js:41)
 *
 * The current code re-attaches the `.catch` to the promise returned by
 * `startGraphQL()` and reports the real source of the failure. This test locks
 * both properties in place.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexFile = path.resolve(__dirname, '../../../graphql/index.js');

describe('graphql/index.js startup catch (issue #6663)', () => {
  it('module parses cleanly under `node --check`', () => {
    const result = spawnSync(process.execPath, ['--check', indexFile], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('does not contain the dangling `.catch` continuation or stale message', () => {
    const source = readFileSync(indexFile, 'utf8');
    expect(source).not.toContain('startGraphQL();');
    expect(source).not.toContain('Promise.all failed:');
  });

  it('attaches a single .catch to the startGraphQL promise with an accurate message', () => {
    const source = readFileSync(indexFile, 'utf8');
    const lastLine = source.trim().split('\n').pop();

    expect(lastLine.trim()).toBe(
      'startGraphQL().catch(err => console.error("startGraphQL failed:", err));',
    );

    const catchCount = (source.match(/startGraphQL\(\)\.catch/g) ?? []).length;
    expect(catchCount, 'expected exactly one .catch on the startup promise')
      .toBe(1);
  });
});
