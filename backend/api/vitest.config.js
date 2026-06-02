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

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.js'],
    setupFiles: ['test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/index.js', 'src/config/db.js', 'src/sockets/**'],
    },
  },
});
