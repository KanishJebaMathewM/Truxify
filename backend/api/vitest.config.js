/**
 * Vitest configuration for the backend API.
 *
 * Picks up:
 *   - test/unit/**\/*.test.js
 *   - test/integration/**\/*.test.js
 *
 * The integration tests use `vi.mock('../../src/config/db.js', ...)` to
 * swap supabase out for the in-memory mock — no live DB required.
 */

import { defineConfig } from 'vitest/config';
import fs from 'node:fs';

const getSafeRealPath = (dirPath) => {
  try {
    return fs.realpathSync(dirPath);
  } catch (err) {
    return dirPath;
  }
};

export default defineConfig({
  resolve: {
    // Preserve symlinks so that testing under workspace directories containing the '#'
    // character can bypass Vite's URL-based resolution limitations by running
    // from a safe directory junction or symlink.
    preserveSymlinks:
      (!process.cwd().includes('#') && getSafeRealPath(process.cwd()).includes('#')) ||
      process.env.PRESERVE_SYMLINKS === 'true',
  },
  plugins: [
    {
      name: 'remove-shebang',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('.js') || id.endsWith('.ts')) {
          return code.replace(/^#!\/.*/, '');
        }
      },
    },
  ],
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 15000,
    include: ['test/**/*.test.js'],
    setupFiles: ['test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/index.js', 'src/config/db.js'],
    },
  },
});

