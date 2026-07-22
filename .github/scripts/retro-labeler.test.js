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
