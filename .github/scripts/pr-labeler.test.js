'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findLinkedIssueNumbers,
  hasProgramSignal,
  selectLabels
} = require('./pr-labeler');

const availableLabels = [
  'gssoc:approved',
  'level:beginner',
  'level:intermediate',
  'type:bug',
  'type:feature',
  'type:security',
  'type:testing',
  'customer-app',
  'driver-app',
  'flutter',
  'backend',
  'type:api',
  'type:docs',
  'type:performance',
  'type:design',
  'type:devops',
  'type:accessibility',
  'dependencies'
];

test('findLinkedIssueNumbers extracts closing issue references only', () => {
  assert.deepEqual(
    findLinkedIssueNumbers('Fixes #320, relates to #12, resolves owner/repo#44 and closes #320'),
    [320, 44]
  );
});

test('hasProgramSignal detects GSSoC and NSoC mentions', () => {
  const rules = {
    programSignals: ['gssoc', 'nsoc26']
  };

  assert.equal(hasProgramSignal({ title: 'feat: add helper', body: 'GSSoC 2026 PR', rules }), true);
  assert.equal(hasProgramSignal({ title: 'feat: add helper', body: 'regular maintenance', rules }), false);
});

test('selectLabels inherits approved GSSoC labels from linked issue', () => {
  const labels = selectLabels({
    prTitle: 'feat: add customer dashboard',
    prBody: 'Fixes #320',
    changedFiles: ['apps/customer/lib/screens/dashboard.dart'],
    linkedIssueLabels: ['gssoc:approved', 'level:intermediate'],
    currentLabels: [],
    availableLabels
  });

  assert.deepEqual(labels, [
    'customer-app',
    'flutter',
    'gssoc:approved',
    'level:intermediate',
    'type:feature'
  ]);
});

test('selectLabels adds program label when PR declares GSSoC work', () => {
  const labels = selectLabels({
    prTitle: 'fix: guard auth token parsing',
    prBody: 'Submitted under GSSoC 2026.',
    changedFiles: ['backend/api/src/middleware/auth.js'],
    linkedIssueLabels: [],
    currentLabels: [],
    availableLabels
  });

  assert.deepEqual(labels, ['backend', 'gssoc:approved', 'type:api', 'type:bug', 'type:security']);
});

test('selectLabels does not duplicate labels already present on the PR', () => {
  const labels = selectLabels({
    prTitle: 'test: cover shipment route',
    prBody: 'Fixes #99',
    changedFiles: ['backend/api/test/unit/shipment.test.js'],
    linkedIssueLabels: ['gssoc:approved'],
    currentLabels: ['gssoc:approved', 'backend'],
    availableLabels
  });

  assert.deepEqual(labels, ['type:api', 'type:testing']);
});

test('selectLabels ignores labels that do not exist in the repository', () => {
  const labels = selectLabels({
    prTitle: 'docs: update setup',
    prBody: 'Fixes #101',
    changedFiles: ['README.md'],
    linkedIssueLabels: ['level:critical'],
    currentLabels: [],
    availableLabels
  });

  assert.deepEqual(labels, ['gssoc:approved', 'type:docs']);
});

test('selectLabels matches new performance, design, devops, and accessibility prefixes', () => {
  const labelsPerf = selectLabels({
    prTitle: 'perf: optimize load time',
    availableLabels
  });
  assert.deepEqual(labelsPerf, ['gssoc:approved', 'type:performance']);

  const labelsDesign = selectLabels({
    prTitle: 'ui: update dashboard layout',
    availableLabels
  });
  assert.deepEqual(labelsDesign, ['gssoc:approved', 'type:design']);

  const labelsDevOps = selectLabels({
    prTitle: 'ci: add test action',
    availableLabels
  });
  assert.deepEqual(labelsDevOps, ['gssoc:approved', 'type:devops']);

  const labelsA11y = selectLabels({
    prTitle: 'a11y: add screen reader labels',
    availableLabels
  });
  assert.deepEqual(labelsA11y, ['gssoc:approved', 'type:accessibility']);
});
