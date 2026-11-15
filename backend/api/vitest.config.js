
/**
 * Vitest configuration for the backend API.
 *
 * Discovers all test suites under the test directory.
 * Integration tests mock the database module, so no live
 * Supabase connection is required.
 */

import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';

const getSafeRealPath = (dirPath) => {
  try {
    return fs.realpathSync.native(dirPath);
  } catch {
    return dirPath;
  }
};

const cwd = process.cwd();
const realCwd = getSafeRealPath(cwd);

const preserveSymlinks =
  process.env.PRESERVE_SYMLINKS === 'true' ||
  (!cwd.includes('#') && realCwd.includes('#'));

export default defineConfig({
  resolve: {
    preserveSymlinks,
  },

  plugins: [
    {
      name: 'remove-shebang',
      enforce: 'pre',

      transform(code, id) {
        const cleanId = id.split('?')[0];
        const extension = path.extname(cleanId);

        if (extension !== '.js' && extension !== '.ts') {
          return null;
        }

        if (!code.startsWith('#!')) {
          return null;
        }

        return {
          code: code.replace(/^#![^\r\n]*(?:\r?\n|$)/, ''),
          map: null,
        };
      },
    },
  ],

  test: {
    environment: 'node',
    globals: true,

    testTimeout: 15000,

    passWithNoTests: true,

    include: ['test/**/*.test.js'],

    setupFiles: ['test/setup.js'],

    coverage: {
      provider: 'v8',

      reporter: ['text', 'html', 'lcov'],

      include: ['src/**/*.js'],

      exclude: [
        'src/index.js',
        'src/config/db.js',
      ],
    },
  },
});
