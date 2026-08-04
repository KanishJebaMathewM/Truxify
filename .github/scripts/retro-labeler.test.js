'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkRetroChanges, run } = require('./retro-labeler');

test('checkRetroChanges returns level:beginner and gssoc:approved for human PR with no labels (merged)', () => {
  const result = checkRetroChanges({
    labels: [],
    merged_at: '2026-07-19T22:00:00Z',
    user: { login: 'human' }
  });
  assert.deepEqual(result.toAdd, ['gssoc:approved', 'level:beginner']);
  assert.deepEqual(result.toRemove, []);
});

test('checkRetroChanges migrates Beginner to level:beginner and adds gssoc:approved for human PR (merged)', () => {
  const result = checkRetroChanges({
    labels: [{ name: 'Beginner' }],
    merged_at: '2026-07-19T22:00:00Z',
    user: { login: 'human' }
  });
  assert.deepEqual(result.toAdd, ['level:beginner', 'gssoc:approved']);
  assert.deepEqual(result.toRemove, ['Beginner']);
});

test('checkRetroChanges removes gssoc:approved and difficulty labels from Dependabot PR', () => {
  const result = checkRetroChanges({
    labels: [{ name: 'gssoc:approved' }, { name: 'level:beginner' }, { name: 'other-label' }],
    merged_at: '2026-07-19T22:00:00Z',
    user: { login: 'dependabot[bot]' }
  });
  assert.deepEqual(result.toAdd, []);
  assert.deepEqual(result.toRemove, ['gssoc:approved', 'level:beginner']);
});

test('checkRetroChanges does not add labels to unmerged closed human PR but does migrate Beginner if present and removes gssoc:approved', () => {
  const result1 = checkRetroChanges({
    labels: [],
    merged_at: null,
    user: { login: 'human' }
  });
  assert.deepEqual(result1.toAdd, []);
  assert.deepEqual(result1.toRemove, []);

  const result2 = checkRetroChanges({
    labels: [{ name: 'Beginner' }],
    merged_at: null,
    user: { login: 'human' }
  });
  assert.deepEqual(result2.toAdd, ['level:beginner']);
  assert.deepEqual(result2.toRemove, ['Beginner']);

  const result3 = checkRetroChanges({
    labels: [{ name: 'gssoc:approved' }],
    merged_at: null,
    user: { login: 'human' }
  });
  assert.deepEqual(result3.toAdd, []);
  assert.deepEqual(result3.toRemove, ['gssoc:approved']);
});

test('run function performs additions and removals correctly', async () => {
  let createdLabels = [];
  let addedLabels = {};
  let removedLabels = {};

  const mockGithub = {
    paginate: async (fn, params) => {
      if (fn === mockGithub.rest.issues.listLabelsForRepo) {
        return [{ name: 'gssoc:approved' }, { name: 'level:beginner' }];
      }
      if (fn === mockGithub.rest.pulls.list) {
        return [
          { number: 101, title: 'Migrate Beginner', labels: [{ name: 'Beginner' }], merged_at: '2026-07-19T22:00:00Z', user: { login: 'human' } },
          { number: 102, title: 'Clean Dependabot', labels: [{ name: 'gssoc:approved' }, { name: 'level:beginner' }], merged_at: '2026-07-19T22:00:00Z', user: { login: 'dependabot[bot]' } }
        ];
      }
      return [];
    },
    rest: {
      issues: {
        listLabelsForRepo: () => {},
        createLabel: async ({ name }) => {
          createdLabels.push(name);
        },
        addLabels: async ({ issue_number, labels }) => {
          addedLabels[issue_number] = labels;
        },
        removeLabel: async ({ issue_number, name }) => {
          if (!removedLabels[issue_number]) removedLabels[issue_number] = [];
          removedLabels[issue_number].push(name);
        }
      },
      pulls: {
        list: () => {}
      }
    }
  };

  const mockContext = {
    repo: { owner: 'owner', repo: 'repo' }
  };

  const mockCore = {
    info: () => {},
    error: () => {}
  };

  const count = await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    dryRun: false
  });

  assert.equal(count, 2);
  assert.deepEqual(addedLabels[101], ['level:beginner', 'gssoc:approved']);
  assert.deepEqual(removedLabels[101], ['Beginner']);
  assert.deepEqual(addedLabels[102], undefined);
  assert.deepEqual(removedLabels[102].sort(), ['gssoc:approved', 'level:beginner'].sort());
});

test('deduplicateTypeLabels keeps the dominant type label by file-change score', () => {
  const { deduplicateTypeLabels } = require('./retro-labeler');
  const rules = {
    typeLabelPriority: [
      'type:security', 'type:performance', 'type:bug', 'type:feature',
      'type:refactor', 'type:testing', 'type:design', 'type:devops',
      'type:docs', 'type:accessibility'
    ],
    pathRules: [
      { pattern: '(^test/|/test/|\\.test\\.|_test\\.)', labels: ['type:testing'] },
      { pattern: '(^docs/|README|CONTRIBUTING|\\.md$)', labels: ['type:docs'] }
    ],
    titleRules: [
      { pattern: '^(test|tests)', labels: ['type:testing'] }
    ]
  };

  const result = deduplicateTypeLabels({
    currentLabels: [{ name: 'type:testing' }, { name: 'type:docs' }, { name: 'type:bug' }],
    changedFiles: [
      'backend/api/test/unit/a.test.js',
      'backend/api/test/unit/b.test.js',
      'docs/README.md'
    ],
    prTitle: 'test: add unit tests',
    rules
  });

  assert.equal(result.toKeep, 'type:testing');
  assert.deepEqual(result.toRemove.sort(), ['type:bug', 'type:docs'].sort());
});

test('deduplicateTypeLabels uses priority tiebreaker when scores are equal', () => {
  const { deduplicateTypeLabels } = require('./retro-labeler');
  const rules = {
    typeLabelPriority: [
      'type:security', 'type:performance', 'type:bug', 'type:feature',
      'type:refactor', 'type:testing', 'type:design', 'type:devops',
      'type:docs', 'type:accessibility'
    ],
    pathRules: [],
    titleRules: []
  };

  const result = deduplicateTypeLabels({
    currentLabels: [{ name: 'type:bug' }, { name: 'type:security' }],
    changedFiles: [],
    prTitle: 'misc change',
    rules
  });

  assert.equal(result.toKeep, 'type:security');
  assert.deepEqual(result.toRemove, ['type:bug']);
});

test('deduplicateTypeLabels returns no changes when 0 or 1 contested type labels', () => {
  const { deduplicateTypeLabels } = require('./retro-labeler');
  const rules = { typeLabelPriority: [
    'type:security', 'type:performance', 'type:bug', 'type:feature',
    'type:refactor', 'type:testing', 'type:design', 'type:devops',
    'type:docs', 'type:accessibility'
  ]};

  const result = deduplicateTypeLabels({
    currentLabels: [{ name: 'type:bug' }, { name: 'type:api' }],
    changedFiles: [],
    prTitle: 'fix: something',
    rules
  });

  assert.equal(result.toKeep, 'type:bug');
  assert.deepEqual(result.toRemove, []);
});

test('isRateLimitError correctly identifies HTTP 403 / 429 rate limit errors', () => {
  const { isRateLimitError } = require('./retro-labeler');

  assert.equal(isRateLimitError(null), false);
  assert.equal(isRateLimitError(new Error('Normal error')), false);
  
  const err403 = new Error('API rate limit exceeded for installation');
  err403.status = 403;
  assert.equal(isRateLimitError(err403), true);

  const err429 = new Error('Too many requests');
  err429.status = 429;
  assert.equal(isRateLimitError(err429), true);
});

test('run function handles rate limit error gracefully without crashing', async () => {
  const { run } = require('./retro-labeler');
  let warningLogged = false;

  const mockRateLimitError = new Error('API rate limit exceeded for installation');
  mockRateLimitError.status = 403;

  const mockGithub = {
    paginate: async () => {
      throw mockRateLimitError;
    },
    rest: {
      issues: {
        listLabelsForRepo: () => {}
      }
    }
  };

  const mockContext = { repo: { owner: 'owner', repo: 'repo' } };
  const mockCore = {
    info: () => {},
    warning: (msg) => {
      if (msg.includes('rate limit exceeded')) warningLogged = true;
    },
    error: () => {}
  };

  const count = await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    dryRun: false
  });

  assert.equal(count, 0);
  assert.equal(warningLogged, true);
});

