import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';

it('loads Swagger configuration as valid ESM before application startup', () => {
  const config = fileURLToPath(new URL('../../src/config/swagger.js', import.meta.url));
  expect(() => execFileSync(process.execPath, ['--check', config], { stdio: 'pipe' })).not.toThrow();
});
