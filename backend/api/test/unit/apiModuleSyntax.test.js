import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';

it.each([
  'routes/publicTrackingRoutes.js',
  'routes/auditRoutes.js',
  'services/blockchain/eventListener.js',
])('parses the API module %s before startup', (relativePath) => {
  const modulePath = fileURLToPath(new URL(`../../src/${relativePath}`, import.meta.url));
  expect(() => execFileSync(process.execPath, ['--check', modulePath], { stdio: 'pipe' })).not.toThrow();
});
