'use strict';

/**
 * Repository path-portability guard.
 *
 * Why this exists
 * ---------------
 * Linux (case-sensitive, dots/spaces are ordinary characters) lets a tree hold
 * two entries that Windows (NTFS) and default macOS (APFS) cannot tell apart:
 *
 *   services/escrowFundingReconciliation.js     <- real 366-line module
 *   services/escrowFundingReconciliation.js.    <- stray scratch snippet
 *
 * NTFS silently strips trailing dots/spaces and compares names
 * case-insensitively, so on checkout both entries resolve to ONE file and the
 * last write wins. On a Windows clone the real module was replaced by a
 * 13-line snippet with no exports, which makes `import { start... } from
 * './services/escrowFundingReconciliation.js'` in src/index.js fail and the API
 * refuse to boot. Linux CI never sees it, so nothing caught it.
 *
 * Rules
 * -----
 * HARD (never baselined):
 *   - a path component ending in "." or " "      (NTFS strips it -> collision)
 *   - a component containing  < > : " | ? * \  or a control character
 *   - a component whose base name is a Windows device name (CON, NUL, COM1 ...)
 * RATCHET (known legacy debt lives in the baseline file; no NEW entries allowed
 * and entries must be removed from the baseline once they are fixed):
 *   - two tracked paths that are identical after case-folding and
 *     trailing-dot/space stripping
 *
 * Usage:
 *   node .github/scripts/check-path-portability.cjs
 *   node .github/scripts/check-path-portability.cjs --write-baseline
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASELINE_FILE = path.join('.github', 'path-portability-baseline.json');

const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"|?*\\\u0000-\u001f]/;
const TRAILING_DOT_OR_SPACE = /[. ]+$/;

function normalizePath(p) {
  return p
    .split('/')
    .map((component) => component.replace(TRAILING_DOT_OR_SPACE, '').toLowerCase())
    .join('/');
}

/**
 * Pure analysis step (no I/O) so it can be unit tested.
 * @param {string[]} paths repo-relative, "/"-separated tracked paths
 * @returns {{violations: {rule: string, path: string, detail: string}[],
 *            collisions: {key: string, paths: string[]}[]}}
 */
function analyzePaths(paths) {
  const violations = [];
  const groups = new Map();

  for (const p of paths) {
    for (const component of p.split('/')) {
      if (TRAILING_DOT_OR_SPACE.test(component)) {
        violations.push({
          rule: 'trailing-dot-or-space',
          path: p,
          detail: `component "${component}" ends with "." or " "; Windows strips it, so this path collides with the same name without it`,
        });
      }
      if (INVALID_CHARS.test(component)) {
        violations.push({
          rule: 'invalid-character',
          path: p,
          detail: `component "${component}" contains a character that is not valid in Windows file names`,
        });
      }
      const base = component.split('.')[0];
      if (WINDOWS_DEVICE_NAME.test(base)) {
        violations.push({
          rule: 'windows-device-name',
          path: p,
          detail: `component "${component}" uses reserved Windows device name "${base}"`,
        });
      }
    }

    const key = normalizePath(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const collisions = [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({ key, paths: members.slice().sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return { violations, collisions };
}

/**
 * Compare current collisions with the committed baseline.
 * @returns {{added: object[], stale: string[]}}
 */
function diffAgainstBaseline(collisions, baselineKeys) {
  const known = new Set(baselineKeys);
  const current = new Set(collisions.map((c) => c.key));
  return {
    added: collisions.filter((c) => !known.has(c.key)),
    stale: [...known].filter((key) => !current.has(key)).sort(),
  };
}

function listTrackedPaths() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return [];
  const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  return Array.isArray(parsed.knownCaseCollisions) ? parsed.knownCaseCollisions : [];
}

function writeBaseline(collisions) {
  const body = {
    description:
      'Legacy case-only path collisions that cannot be checked out on Windows/macOS. ' +
      'Do not add entries. Remove an entry in the same PR that deletes or renames the duplicate.',
    knownCaseCollisions: collisions.map((c) => c.key),
  };
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(body, null, 2)}\n`);
}

function annotate(level, file, message) {
  // GitHub Actions workflow command; harmless plain text elsewhere.
  const safe = String(message).replace(/\r?\n/g, ' ');
  console.log(`::${level} file=${file}::${safe}`);
}

function main(argv) {
  const { violations, collisions } = analyzePaths(listTrackedPaths());

  if (argv.includes('--write-baseline')) {
    writeBaseline(collisions);
    console.log(`Wrote ${collisions.length} collision(s) to ${BASELINE_FILE}`);
    return 0;
  }

  const { added, stale } = diffAgainstBaseline(collisions, loadBaseline());
  let failed = false;

  for (const v of violations) {
    failed = true;
    annotate('error', v.path, `[${v.rule}] ${v.detail}`);
  }
  for (const c of added) {
    failed = true;
    for (const p of c.paths) {
      annotate('error', p, `[case-collision] collides with: ${c.paths.filter((x) => x !== p).join(', ')}`);
    }
  }
  for (const key of stale) {
    failed = true;
    annotate('error', BASELINE_FILE, `[stale-baseline] "${key}" no longer collides; remove it from the baseline`);
  }

  if (failed) {
    console.error(
      '\nPath-portability check failed. These paths cannot be checked out intact on Windows/macOS,\n' +
        'where one entry silently overwrites another and can replace a real module with a stub.\n' +
        'Delete or rename the duplicate (keep the variant that is actually imported).'
    );
    return 1;
  }

  console.log(
    `Path-portability OK: ${collisions.length} legacy collision(s) baselined, no new hazards.`
  );
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { analyzePaths, diffAgainstBaseline, normalizePath };
