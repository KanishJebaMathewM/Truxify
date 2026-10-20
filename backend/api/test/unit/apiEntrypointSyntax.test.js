import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('the API entrypoint parses without running startup side effects', () => {
  const entrypoint = fileURLToPath(new URL('../../src/index.js', import.meta.url));
  // --check parses only: no credentials, DB connections, workers or listener.
  const result = spawnSync(process.execPath, ['--check', entrypoint], { encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
