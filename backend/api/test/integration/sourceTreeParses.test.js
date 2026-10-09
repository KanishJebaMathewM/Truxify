import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_DIR = path.resolve(BACKEND_API_DIR, '..');

// Files whose parse errors are fixed in separate, already-open PRs. Remove an
// entry from this list as soon as its fix PR merges so the whole tree is
// covered again.
const EXEMPT_PARSE_FILES = new Set([
  'src/lib/profileCache.js',
  'src/services/webrtc/WebRTCSignalingServer.js',
]);

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'build', '.next']);
const JS_EXT = '.js';

function collectJsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(JS_EXT)) {
      results.push(full);
    }
  }
  return results;
}

function parseCheck(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return null;
  } catch (err) {
    const firstLine = String(err.stderr || err.message).split('\n').find(l => l.includes('SyntaxError')) || String(err.message).split('\n')[0];
    return firstLine;
  }
}

describe('backend/api source tree parser integrity', () => {
  it('every .js file under backend/api (including the API root and tests) must compile', { timeout: 300000 }, () => {
    const files = collectJsFiles(ROOT_DIR).filter(f => f.startsWith(BACKEND_API_DIR));
    expect(files.length).toBeGreaterThan(100);

    failed: {
      const failures = files
        .map(f => ({ rel: path.relative(BACKEND_API_DIR, f), error: parseCheck(f) }))
        .filter(({ error }) => error !== null);

      const fmt = rel => rel.replace(/\\/g, '/');
      const observed = failures.map(({ rel }) => fmt(rel)).sort();

      if (observed.length !== 0) {
        for (const rel of observed) {
          if (!EXEMPT_PARSE_FILES.has(rel)) {
            const detail = failures.find(f => fmt(f.rel) === rel).error;
            expect(`file failed to parse: ${rel}: ${detail}`).toBe(undefined);
          }
        }
      }

      for (const exempt of EXEMPT_PARSE_FILES) {
        if (!observed.includes(exempt)) {
          expect(`exempt parse file is no longer failing and can be re-enabled: ${exempt}`).toBe(undefined);
        }
      }
    }
  });
});