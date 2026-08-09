/**
 * Startup smoke test for the Kafka event service import graph.
 *
 * Regression test for issue #6286: depth-2 modules under backend/kafka/
 * (consumers, repositories, cqrs, scripts) used `../api/src/...`, which
 * resolved to a non-existent `backend/kafka/api/` subtree and crashed the
 * service with MODULE_NOT_FOUND. This test statically resolves every
 * `from '.../api/src/...'` import specifier against the real filesystem so
 * the boot path is verified without needing live Kafka/Supabase.
 *
 * Run with:  npm test -- test/smoke.test.js
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kafkaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IMPORT_RE = /from\s+['"]([^'"]+)['"]/g;
const API_SRC_IMPORT = /^\.{1,2}\/api\/src\//;

function collectApiSrcImports(file) {
  const content = fs.readFileSync(file, 'utf8');
  const specifiers = [];
  let match;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    if (API_SRC_IMPORT.test(match[1])) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function* listSourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* listSourceFiles(full);
    } else if (entry.name.endsWith('.js')) {
      yield full;
    }
  }
}

describe('Kafka service import graph', () => {
  it('every api/src import resolves to an existing file', () => {
    const failures = [];
    let checked = 0;

    for (const file of listSourceFiles(kafkaRoot)) {
      for (const spec of collectApiSrcImports(file)) {
        checked += 1;
        const resolved = path.resolve(path.dirname(file), spec);
        if (!fs.existsSync(resolved)) {
          failures.push(`${path.relative(kafkaRoot, file)} -> ${spec}`);
        }
      }
    }

    expect(checked).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it('depth-2 modules use the ../../api/src depth', () => {
    const depthTwoDirs = ['consumers', 'repositories', 'cqrs', 'scripts'];
    for (const dir of depthTwoDirs) {
      const dirPath = path.join(kafkaRoot, dir);
      if (!fs.existsSync(dirPath)) continue;
      for (const file of listSourceFiles(dirPath)) {
        for (const spec of collectApiSrcImports(file)) {
          expect(
            spec,
            `${path.relative(kafkaRoot, file)} must import api/src via ../../api/src`
          ).toMatch(/^\.\.\/\.\.\/api\/src\//);
        }
      }
    }
  });
});
