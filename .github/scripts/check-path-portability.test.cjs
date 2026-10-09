'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzePaths, diffAgainstBaseline, normalizePath } = require('./check-path-portability.cjs');

const rules = (result) => result.violations.map((v) => v.rule);

test('a clean tree has no violations and no collisions', () => {
  const result = analyzePaths([
    'backend/api/src/index.js',
    'backend/api/src/services/escrow.js',
    '.github/workflows/ci.yml',
    '.gitignore',
    'docs/console.md',
    'src/auxiliary.js',
  ]);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.collisions, []);
});

test('regression: trailing-dot scratch file next to the real escrow reconciler', () => {
  const real = 'backend/api/src/services/escrowFundingReconciliation.js';
  const stray = `${real}.`;
  const result = analyzePaths([real, stray]);

  assert.deepEqual(rules(result), ['trailing-dot-or-space']);
  assert.equal(result.violations[0].path, stray);
  // NTFS folds both entries onto one file, so they must also surface as a collision.
  assert.equal(result.collisions.length, 1);
  assert.deepEqual(result.collisions[0].paths, [real, stray].sort());
});

test('trailing space and multiple trailing dots are flagged', () => {
  assert.deepEqual(rules(analyzePaths(['docs/notes.md '])), ['trailing-dot-or-space']);
  assert.deepEqual(rules(analyzePaths(['docs/notes.md..'])), ['trailing-dot-or-space']);
});

test('a trailing dot on a directory component is flagged', () => {
  assert.deepEqual(rules(analyzePaths(['src./index.js'])), ['trailing-dot-or-space']);
});

test('case-only duplicates are reported as one collision group', () => {
  const result = analyzePaths([
    'backend/api/src/sockets/tracker.js',
    'backend/api/src/sockets/Tracker.js',
    'backend/api/src/sockets/other.js',
  ]);
  assert.deepEqual(result.violations, []);
  assert.equal(result.collisions.length, 1);
  assert.equal(result.collisions[0].key, 'backend/api/src/sockets/tracker.js');
  assert.equal(result.collisions[0].paths.length, 2);
});

test('three-way case collision stays a single group', () => {
  const result = analyzePaths(['t/a.test.js', 't/A.test.js', 't/a.TEST.js']);
  assert.equal(result.collisions.length, 1);
  assert.equal(result.collisions[0].paths.length, 3);
});

test('collisions are detected through a differently-cased parent directory', () => {
  const result = analyzePaths(['Src/a.js', 'src/a.js']);
  assert.equal(result.collisions.length, 1);
});

test('invalid Windows characters are flagged', () => {
  for (const p of ['a/b:c.txt', 'a/b?.txt', 'a/b*.txt', 'a/b|c.txt', 'a/"q".txt', 'a/b<c>.txt', 'a/b\\c.txt']) {
    assert.deepEqual(rules(analyzePaths([p])), ['invalid-character'], p);
  }
});

test('Windows device names are flagged with or without an extension, any case', () => {
  for (const p of ['src/aux.js', 'src/NUL', 'src/Com1.txt', 'src/lpt9.log', 'con/index.js']) {
    assert.deepEqual(rules(analyzePaths([p])), ['windows-device-name'], p);
  }
});

test('names that merely start with a device name are not flagged', () => {
  const result = analyzePaths(['src/console.js', 'src/nullable.js', 'src/com10.txt', 'src/auxiliary.js']);
  assert.deepEqual(result.violations, []);
});

test('normalizePath folds case and strips trailing dots/spaces per component', () => {
  assert.equal(normalizePath('A/B.JS.'), 'a/b.js');
  assert.equal(normalizePath('Dir /File.txt'), 'dir/file.txt');
});

test('baseline: known collisions pass, new ones are reported', () => {
  const collisions = [
    { key: 'a/known.js', paths: ['a/Known.js', 'a/known.js'] },
    { key: 'a/new.js', paths: ['a/New.js', 'a/new.js'] },
  ];
  const { added, stale } = diffAgainstBaseline(collisions, ['a/known.js']);
  assert.deepEqual(added.map((c) => c.key), ['a/new.js']);
  assert.deepEqual(stale, []);
});

test('baseline: entries that no longer collide are reported as stale (ratchet)', () => {
  const { added, stale } = diffAgainstBaseline([], ['a/fixed.js', 'a/also-fixed.js']);
  assert.deepEqual(added, []);
  assert.deepEqual(stale, ['a/also-fixed.js', 'a/fixed.js']);
});
