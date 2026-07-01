'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findLinkedIssueNumbers,
  hasProgramSignal,
  selectLabels,
  run
} = require('./pr-labeler');

const availableLabels = [
  'gssoc:approved',
  'ECSoC26',
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

test('selectLabels adds program label when PR declares ECSoC work', () => {
  const labels = selectLabels({
    prTitle: 'fix: guard auth token parsing',
    prBody: 'Submitted under ECSoC 2026.',
    changedFiles: ['backend/api/src/middleware/auth.js'],
    linkedIssueLabels: [],
    currentLabels: [],
    availableLabels
  });

  assert.deepEqual(labels, ['backend', 'ECSoC26', 'type:api', 'type:bug', 'type:security']);
});

test('selectLabels does not add program label by default when neither GSSoC nor ECSoC is mentioned', () => {
  const labels = selectLabels({
    prTitle: 'fix: guard auth token parsing',
    prBody: 'Just fixing a regular bug.',
    changedFiles: ['backend/api/src/middleware/auth.js'],
    linkedIssueLabels: [],
    currentLabels: [],
    availableLabels
  });

  assert.deepEqual(labels, ['backend', 'type:api', 'type:bug', 'type:security']);
});

test('selectLabels handles case-insensitivity for GSSoC and ECSoC', () => {
  const labelsGssoc = selectLabels({
    prTitle: 'feat: new feature [GsSoC]',
    availableLabels
  });
  assert.equal(labelsGssoc.includes('gssoc:approved'), true);

  const labelsEcsoc = selectLabels({
    prTitle: 'feat: new feature [ecSoC]',
    availableLabels
  });
  assert.equal(labelsEcsoc.includes('ECSoC26'), true);
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
    availableLabels,
    detectedPrograms: ['gssoc']
  });

  assert.deepEqual(labels, ['gssoc:approved', 'type:docs']);
});

test('selectLabels matches new performance, design, devops, and accessibility prefixes', () => {
  const labelsPerf = selectLabels({
    prTitle: 'perf: optimize load time',
    availableLabels,
    detectedPrograms: ['gssoc']
  });
  assert.deepEqual(labelsPerf, ['gssoc:approved', 'type:performance']);

  const labelsDesign = selectLabels({
    prTitle: 'ui: update dashboard layout',
    availableLabels,
    detectedPrograms: ['gssoc']
  });
  assert.deepEqual(labelsDesign, ['gssoc:approved', 'type:design']);

  const labelsDevOps = selectLabels({
    prTitle: 'ci: add test action',
    availableLabels,
    detectedPrograms: ['gssoc']
  });
  assert.deepEqual(labelsDevOps, ['gssoc:approved', 'type:devops']);

  const labelsA11y = selectLabels({
    prTitle: 'a11y: add screen reader labels',
    availableLabels,
    detectedPrograms: ['gssoc']
  });
  assert.deepEqual(labelsA11y, ['gssoc:approved', 'type:accessibility']);
});

test('run function adds merge conflicts label if PR is not mergeable', async () => {
  const mockGithub = {
    paginate: async (fn, params) => {
      if (fn === mockGithub.rest.issues.listLabelsForRepo) return [{ name: 'merge conflicts' }];
      if (fn === mockGithub.rest.pulls.listFiles) return [];
      if (fn === mockGithub.rest.issues.listComments) return [];
      return [];
    },
    rest: {
      pulls: {
        get: async () => ({
          data: {
            number: 123,
            title: 'feat: new feature',
            body: 'GSSoC',
            labels: [],
            mergeable: false,
            mergeable_state: 'dirty'
          }
        }),
        listFiles: () => {}
      },
      issues: {
        get: async () => ({ data: { labels: [] } }),
        listLabelsForRepo: () => {},
        listComments: () => {},
        createLabel: async () => {},
        createComment: async () => {},
        addLabels: async ({ labels }) => {
          assert.equal(labels.includes('merge conflicts'), true);
        }
      }
    }
  };

  const mockContext = {
    payload: {
      pull_request: {
        number: 123,
        labels: []
      }
    },
    repo: { owner: 'owner', repo: 'repo' }
  };

  const mockCore = {
    info: () => {},
    warning: () => {}
  };

  await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    rulesPath: undefined,
    dryRun: false
  });
});

test('run function removes merge conflicts label if PR is mergeable', async () => {
  let removeLabelCalled = false;
  const mockGithub = {
    paginate: async (fn, params) => {
      if (fn === mockGithub.rest.issues.listLabelsForRepo) return [{ name: 'merge conflicts' }];
      if (fn === mockGithub.rest.pulls.listFiles) return [];
      if (fn === mockGithub.rest.issues.listComments) return [];
      return [];
    },
    rest: {
      pulls: {
        get: async () => ({
          data: {
            number: 123,
            title: 'feat: new feature',
            body: 'GSSoC',
            labels: [{ name: 'merge conflicts' }],
            mergeable: true,
            mergeable_state: 'clean'
          }
        }),
        listFiles: () => {}
      },
      issues: {
        get: async () => ({ data: { labels: [] } }),
        listLabelsForRepo: () => {},
        listComments: () => {},
        createLabel: async () => {},
        createComment: async () => {},
        addLabels: async () => {},
        removeLabel: async ({ name }) => {
          assert.equal(name, 'merge conflicts');
          removeLabelCalled = true;
        }
      }
    }
  };

  const mockContext = {
    payload: {
      pull_request: {
        number: 123,
        labels: [{ name: 'merge conflicts' }]
      }
    },
    repo: { owner: 'owner', repo: 'repo' }
  };

  const mockCore = {
    info: () => {},
    warning: () => {}
  };

  await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    rulesPath: undefined,
    dryRun: false
  });

  assert.equal(removeLabelCalled, true);
});
