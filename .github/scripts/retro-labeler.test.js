'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkLabels, run } = require('./retro-labeler');

test('checkLabels returns both gssoc:approved and Beginner if PR has no labels', () => {
  const result = checkLabels([]);
  assert.deepEqual(result, ['gssoc:approved', 'Beginner']);
});

test('checkLabels returns Beginner if PR already has gssoc:approved but no difficulty label', () => {
  const result = checkLabels(['gssoc:approved']);
  assert.deepEqual(result, ['Beginner']);
});

test('checkLabels returns gssoc:approved if PR already has difficulty label (exact casing)', () => {
  const result = checkLabels(['Intermediate']);
  assert.deepEqual(result, ['gssoc:approved']);
});

test('checkLabels returns gssoc:approved if PR already has difficulty label (prefixed)', () => {
  const result = checkLabels(['level:advanced']);
  assert.deepEqual(result, ['gssoc:approved']);
});

test('checkLabels returns empty array if PR has both gssoc:approved and difficulty label', () => {
  const result = checkLabels(['gssoc:approved', 'Critical']);
  assert.deepEqual(result, []);
});

test('run function paginates, checks, and adds labels when dryRun is false', async () => {
  let createdLabels = [];
  let addedLabelsToPRs = {};

  const mockGithub = {
    paginate: async (fn, params) => {
      if (fn === mockGithub.rest.issues.listLabelsForRepo) {
        return [{ name: 'some-label' }];
      }
      if (fn === mockGithub.rest.pulls.list) {
        return [
          { number: 101, title: 'First PR', labels: [] },
          { number: 102, title: 'Second PR', labels: [{ name: 'gssoc:approved' }] },
          { number: 103, title: 'Third PR', labels: [{ name: 'level:intermediate' }] },
          { number: 104, title: 'Fourth PR', labels: [{ name: 'gssoc:approved' }, { name: 'Critical' }] }
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
          addedLabelsToPRs[issue_number] = labels;
        }
      },
      pulls: {
        list: () => {}
      }
    }
  };

  const mockContext = {
    repo: { owner: 'test-owner', repo: 'test-repo' }
  };

  const mockCore = {
    info: () => {},
    error: () => {}
  };

  const updatedCount = await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    dryRun: false
  });

  // Verify that required labels were ensured
  assert.equal(createdLabels.includes('gssoc:approved'), true);
  assert.equal(createdLabels.includes('Beginner'), true);

  // Verify updated count (3 PRs should need updates: 101, 102, 103)
  assert.equal(updatedCount, 3);

  // Verify exact labels added to each PR
  assert.deepEqual(addedLabelsToPRs[101], ['gssoc:approved', 'Beginner']);
  assert.deepEqual(addedLabelsToPRs[102], ['Beginner']);
  assert.deepEqual(addedLabelsToPRs[103], ['gssoc:approved']);
  assert.equal(addedLabelsToPRs[104], undefined);
});

test('run function does not add labels or create labels when dryRun is true', async () => {
  let createdLabels = [];
  let addedLabelsToPRs = {};

  const mockGithub = {
    paginate: async (fn, params) => {
      if (fn === mockGithub.rest.issues.listLabelsForRepo) {
        return [];
      }
      if (fn === mockGithub.rest.pulls.list) {
        return [
          { number: 201, title: 'Some PR', labels: [] }
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
          addedLabelsToPRs[issue_number] = labels;
        }
      },
      pulls: {
        list: () => {}
      }
    }
  };

  const mockContext = {
    repo: { owner: 'test-owner', repo: 'test-repo' }
  };

  const mockCore = {
    info: () => {},
    error: () => {}
  };

  const updatedCount = await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    dryRun: true
  });

  assert.equal(updatedCount, 1);
  assert.equal(createdLabels.length, 0);
  assert.deepEqual(addedLabelsToPRs, {});
});
