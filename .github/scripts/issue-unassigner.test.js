
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasLinkedPullRequest,
  getAssignmentTimestamp,
  isEligibleForUnassign,
  createFetchOctokit,
  run
} = require('./issue-unassigner');

test('hasLinkedPullRequest detects cross-referenced PR in timeline', () => {
  const timeline = [
    { event: 'labeled', label: { name: 'bug' } },
    {
      event: 'cross-referenced',
      source: {
        issue: {
          number: 55,
          pull_request: {
            url: 'https://api.github.com/repos/owner/repo/pulls/55'
          }
        }
      }
    }
  ];

  assert.equal(hasLinkedPullRequest(42, timeline, []), true);
});

test('hasLinkedPullRequest detects PR in search items referencing issue number', () => {
  const searchItems = [
    {
      number: 88,
      title: 'feat: add customer view (fixes #42)',
      body: 'Addresses the open issue'
    }
  ];

  assert.equal(hasLinkedPullRequest(42, [], searchItems), true);
  assert.equal(hasLinkedPullRequest(99, [], searchItems), false);
});

test('hasLinkedPullRequest returns false when no PR is linked or found', () => {
  assert.equal(hasLinkedPullRequest(42, [], []), false);
});

test('getAssignmentTimestamp returns the latest assigned event timestamp', () => {
  const issue = { created_at: '2026-09-01T00:00:00Z' };

  const timeline = [
    { event: 'assigned', created_at: '2026-09-02T10:00:00Z' },
    { event: 'assigned', created_at: '2026-09-05T12:00:00Z' }
  ];

  const ts = getAssignmentTimestamp(issue, timeline);

  assert.equal(ts, new Date('2026-09-05T12:00:00Z').getTime());
});

test('getAssignmentTimestamp falls back to issue created_at if no assigned event exists', () => {
  const issue = { created_at: '2026-09-01T00:00:00Z' };

  const ts = getAssignmentTimestamp(issue, []);

  assert.equal(ts, new Date('2026-09-01T00:00:00Z').getTime());
});

test('isEligibleForUnassign returns ineligible if assigned under 7 days ago', () => {
  const now = new Date('2026-09-10T00:00:00Z').getTime();

  const issue = {
    number: 10,
    created_at: '2026-09-01T00:00:00Z',
    assignees: [{ login: 'alice' }]
  };

  const timeline = [
    { event: 'assigned', created_at: '2026-09-06T00:00:00Z' }
  ];

  const result = isEligibleForUnassign({
    issue,
    timeline,
    searchItems: [],
    now,
    daysThreshold: 7
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'assigned-recently');
});

test('isEligibleForUnassign returns ineligible if a PR already exists', () => {
  const now = new Date('2026-09-15T00:00:00Z').getTime();

  const issue = {
    number: 10,
    created_at: '2026-09-01T00:00:00Z',
    assignees: [{ login: 'alice' }]
  };

  const timeline = [
    { event: 'assigned', created_at: '2026-09-01T00:00:00Z' },
    {
      event: 'cross-referenced',
      source: {
        issue: {
          number: 50,
          pull_request: {}
        }
      }
    }
  ];

  const result = isEligibleForUnassign({
    issue,
    timeline,
    searchItems: [],
    now,
    daysThreshold: 7
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'pr-exists');
});

test('isEligibleForUnassign returns eligible if assigned >= 7 days ago with no PR', () => {
  const now = new Date('2026-09-15T00:00:00Z').getTime();

  const issue = {
    number: 10,
    created_at: '2026-09-01T00:00:00Z',
    assignees: [{ login: 'alice' }, { login: 'bob' }]
  };

  const timeline = [
    { event: 'assigned', created_at: '2026-09-01T00:00:00Z' }
  ];

  const result = isEligibleForUnassign({
    issue,
    timeline,
    searchItems: [],
    now,
    daysThreshold: 7
  });

  assert.equal(result.eligible, true);
  assert.deepEqual(result.assignees, ['alice', 'bob']);
});

test('run function unassigns contributors, removes label, and posts comment on eligible issues', async () => {
  let removeAssigneesCalled = false;
  let removeLabelCalled = false;
  let commentPosted = false;

  const mockGithub = {
    paginate: async (fn) => {
      if (fn === mockGithub.rest.issues.listForRepo) {
        return [
          {
            number: 101,
            created_at: '2026-08-01T00:00:00Z',
            assignees: [{ login: 'inactiveuser' }],
            labels: [{ name: 'assigned' }, { name: 'type:bug' }]
          }
        ];
      }

      if (fn === mockGithub.rest.issues.listEventsForTimeline) {
        return [
          { event: 'assigned', created_at: '2026-08-01T00:00:00Z' }
        ];
      }

      return [];
    },

    rest: {
      issues: {
        listForRepo: () => {},
        listEventsForTimeline: () => {},

        removeAssignees: async ({ issue_number, assignees }) => {
          assert.equal(issue_number, 101);
          assert.deepEqual(assignees, ['inactiveuser']);
          removeAssigneesCalled = true;
        },

        removeLabel: async ({ issue_number, name }) => {
          assert.equal(issue_number, 101);
          assert.equal(name, 'assigned');
          removeLabelCalled = true;
        },

        createComment: async ({ issue_number, body }) => {
          assert.equal(issue_number, 101);
          assert.equal(body.includes('@inactiveuser'), true);
          assert.equal(
            body.includes('automatically unassigned'),
            true
          );
          commentPosted = true;
        }
      },

      search: {
        issuesAndPullRequests: async () => ({
          data: { items: [] }
        })
      }
    }
  };

  const mockContext = {
    repo: { owner: 'testowner', repo: 'testrepo' }
  };

  const mockCore = {
    info: () => {},
    warning: () => {},
    error: () => {},
    debug: () => {}
  };

  const result = await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    dryRun: false,
    daysThreshold: 7
  });

  assert.equal(result.unassignedCount, 1);
  assert.equal(removeAssigneesCalled, true);
  assert.equal(removeLabelCalled, true);
  assert.equal(commentPosted, true);
});

test('run function in dryRun mode does not modify issues', async () => {
  let modified = false;

  const mockGithub = {
    paginate: async (fn) => {
      if (fn === mockGithub.rest.issues.listForRepo) {
        return [
          {
            number: 102,
            created_at: '2026-08-01T00:00:00Z',
            assignees: [{ login: 'inactiveuser' }],
            labels: [{ name: 'assigned' }]
          }
        ];
      }

      return [
        { event: 'assigned', created_at: '2026-08-01T00:00:00Z' }
      ];
    },

    rest: {
      issues: {
        listForRepo: () => {},
        listEventsForTimeline: () => {},
        removeAssignees: async () => { modified = true; },
        removeLabel: async () => { modified = true; },
        createComment: async () => { modified = true; }
      },

      search: {
        issuesAndPullRequests: async () => ({
          data: { items: [] }
        })
      }
    }
  };

  const mockContext = {
    repo: { owner: 'testowner', repo: 'testrepo' }
  };

  const mockCore = {
    info: () => {},
    warning: () => {},
    error: () => {},
    debug: () => {}
  };

  const result = await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    dryRun: true,
    daysThreshold: 7
  });

  assert.equal(result.unassignedCount, 1);
  assert.equal(modified, false);
});

test('isEligibleForUnassign does not unassign if contributor commented recently', () => {
  const now = new Date('2026-09-15T00:00:00Z').getTime();

  const issue = {
    number: 103,
    created_at: '2026-08-01T00:00:00Z',
    assignees: [{ login: 'testuser' }]
  };

  const timeline = [
    { event: 'assigned', created_at: '2026-08-25T00:00:00Z' },
    {
      event: 'commented',
      actor: { login: 'testuser' },
      created_at: '2026-09-13T00:00:00Z'
    }
  ];

  const result = isEligibleForUnassign({
    issue,
    timeline,
    searchItems: [],
    now,
    daysThreshold: 7
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'recent-contributor-activity');
});

test('isEligibleForUnassign does not unassign if assigned less than 1 week ago', () => {
  const now = new Date('2026-09-15T00:00:00Z').getTime();

  const issue = {
    number: 104,
    created_at: '2026-08-01T00:00:00Z',
    assignees: [{ login: 'testuser' }]
  };

  const timeline = [
    { event: 'assigned', created_at: '2026-09-12T00:00:00Z' }
  ];

  const result = isEligibleForUnassign({
    issue,
    timeline,
    searchItems: [],
    now,
    daysThreshold: 7
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'assigned-recently');
});

test('createFetchOctokit returns an object with paginate and REST methods', () => {
  const client = createFetchOctokit('dummy_token');

  assert.equal(typeof client.paginate, 'function');
  assert.equal(typeof client.rest.issues.listForRepo, 'function');
  assert.equal(typeof client.rest.issues.listEventsForTimeline, 'function');
  assert.equal(typeof client.rest.issues.removeAssignees, 'function');
  assert.equal(typeof client.rest.issues.removeLabel, 'function');
  assert.equal(typeof client.rest.issues.createComment, 'function');
  assert.equal(typeof client.rest.search.issuesAndPullRequests, 'function');
});
