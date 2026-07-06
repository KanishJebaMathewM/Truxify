'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasSubmittedPR,
  handleIssueOpened,
  handleIssueAssigned,
  handleIssueCommentCreated,
  handleScheduledUnassign
} = require('./issue-rules');

// Helper to create a mock GitHub client
function createMockGithub() {
  return {
    rest: {
      search: {
        issuesAndPullRequests: test.mock.fn(async () => ({
          data: { total_count: 0 }
        }))
      },
      issues: {
        createComment: test.mock.fn(async () => {}),
        update: test.mock.fn(async () => {}),
        removeAssignees: test.mock.fn(async () => {}),
        addAssignees: test.mock.fn(async () => {}),
        listForRepo: test.mock.fn(async () => []),
        listEventsForTimeline: test.mock.fn(async () => [])
      }
    },
    paginate: test.mock.fn(async (fn, args) => {
      // Just invoke the function with mock args or return default mock values
      return await fn(args);
    })
  };
}

test('hasSubmittedPR returns true if PR search returns count > 0', async () => {
  const github = createMockGithub();
  github.rest.search.issuesAndPullRequests = test.mock.fn(async () => ({
    data: { total_count: 1 }
  }));

  const result = await hasSubmittedPR(github, 'owner', 'repo', 42, 'test-user', []);
  assert.equal(result, true);
});

test('hasSubmittedPR returns true if timeline has a cross-referenced PR by the assignee', async () => {
  const github = createMockGithub();
  const timeline = [
    {
      event: 'cross-referenced',
      source: {
        issue: {
          pull_request: {},
          user: { login: 'test-user' }
        }
      }
    }
  ];

  const result = await hasSubmittedPR(github, 'owner', 'repo', 42, 'test-user', timeline);
  assert.equal(result, true);
});

test('hasSubmittedPR returns false if no PR is found', async () => {
  const github = createMockGithub();
  const timeline = [
    {
      event: 'cross-referenced',
      source: {
        issue: {
          pull_request: {},
          user: { login: 'other-user' }
        }
      }
    }
  ];

  const result = await hasSubmittedPR(github, 'owner', 'repo', 42, 'test-user', timeline);
  assert.equal(result, false);
});

test('handleIssueOpened closes issue if creator has > 5 open issues', async () => {
  const github = createMockGithub();
  github.rest.search.issuesAndPullRequests = test.mock.fn(async () => ({
    data: { total_count: 6 } // 6 open issues
  }));

  const context = {
    repo: { owner: 'owner', repo: 'repo' },
    payload: {
      issue: {
        number: 42,
        user: { login: 'test-user' }
      }
    }
  };

  await handleIssueOpened({ github, context });

  assert.equal(github.rest.issues.createComment.mock.calls.length, 1);
  assert.equal(github.rest.issues.update.mock.calls.length, 1);
  assert.deepEqual(github.rest.issues.update.mock.calls[0].arguments[0], {
    owner: 'owner',
    repo: 'repo',
    issue_number: 42,
    state: 'closed'
  });
});

test('handleIssueOpened does not close issue if creator has <= 5 open issues', async () => {
  const github = createMockGithub();
  github.rest.search.issuesAndPullRequests = test.mock.fn(async () => ({
    data: { total_count: 3 } // 3 open issues
  }));

  const context = {
    repo: { owner: 'owner', repo: 'repo' },
    payload: {
      issue: {
        number: 42,
        user: { login: 'test-user' }
      }
    }
  };

  await handleIssueOpened({ github, context });

  assert.equal(github.rest.issues.createComment.mock.calls.length, 0);
  assert.equal(github.rest.issues.update.mock.calls.length, 0);
});

test('handleIssueAssigned removes assignment if user has > 3 open assigned issues', async () => {
  const github = createMockGithub();
  github.rest.search.issuesAndPullRequests = test.mock.fn(async () => ({
    data: { total_count: 4 } // 4 assigned open issues
  }));

  const context = {
    repo: { owner: 'owner', repo: 'repo' },
    payload: {
      assignee: { login: 'test-user' },
      issue: { number: 42 }
    }
  };

  await handleIssueAssigned({ github, context });

  assert.equal(github.rest.issues.createComment.mock.calls.length, 1);
  assert.equal(github.rest.issues.removeAssignees.mock.calls.length, 1);
  assert.deepEqual(github.rest.issues.removeAssignees.mock.calls[0].arguments[0], {
    owner: 'owner',
    repo: 'repo',
    issue_number: 42,
    assignees: ['test-user']
  });
});

test('handleIssueCommentCreated auto-assigns commenter on .take or /assign', async () => {
  const github = createMockGithub();
  // Mock count to be 1 assigned issue (which is < 3)
  github.rest.search.issuesAndPullRequests = test.mock.fn(async () => ({
    data: { total_count: 1 }
  }));

  const context = {
    repo: { owner: 'owner', repo: 'repo' },
    payload: {
      comment: {
        body: '.take',
        user: { login: 'test-user' }
      },
      issue: {
        number: 42,
        assignees: []
      }
    }
  };

  await handleIssueCommentCreated({ github, context });

  assert.equal(github.rest.issues.addAssignees.mock.calls.length, 1);
  assert.deepEqual(github.rest.issues.addAssignees.mock.calls[0].arguments[0], {
    owner: 'owner',
    repo: 'repo',
    issue_number: 42,
    assignees: ['test-user']
  });
  assert.equal(github.rest.issues.createComment.mock.calls.length, 1);
  assert.match(github.rest.issues.createComment.mock.calls[0].arguments[0].body, /successfully assigned/);
});

test('handleIssueCommentCreated does not assign if user already has >= 3 assigned open issues', async () => {
  const github = createMockGithub();
  github.rest.search.issuesAndPullRequests = test.mock.fn(async () => ({
    data: { total_count: 3 }
  }));

  const context = {
    repo: { owner: 'owner', repo: 'repo' },
    payload: {
      comment: {
        body: '/assign',
        user: { login: 'test-user' }
      },
      issue: {
        number: 42,
        assignees: []
      }
    }
  };

  await handleIssueCommentCreated({ github, context });

  assert.equal(github.rest.issues.addAssignees.mock.calls.length, 0);
  assert.equal(github.rest.issues.createComment.mock.calls.length, 1);
  assert.match(github.rest.issues.createComment.mock.calls[0].arguments[0].body, /cannot be assigned to more than 3/);
});

test('handleScheduledUnassign unassigns user after 5 days without PR', async () => {
  const github = createMockGithub();
  
  // 1. Mock listForRepo to return one open assigned issue
  github.rest.issues.listForRepo = test.mock.fn(async () => [
    {
      number: 42,
      pull_request: null,
      assignees: [{ login: 'test-user' }],
      created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString() // 6 days ago
    }
  ]);

  // 2. Mock listEventsForTimeline to return the assignment event 6 days ago
  github.rest.issues.listEventsForTimeline = test.mock.fn(async () => [
    {
      event: 'assigned',
      assignee: { login: 'test-user' },
      created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString()
    }
  ]);

  // 3. Mock search to return 0 PRs
  github.rest.search.issuesAndPullRequests = test.mock.fn(async () => ({
    data: { total_count: 0 }
  }));

  const context = {
    repo: { owner: 'owner', repo: 'repo' }
  };

  await handleScheduledUnassign({ github, context });

  assert.equal(github.rest.issues.removeAssignees.mock.calls.length, 1);
  assert.deepEqual(github.rest.issues.removeAssignees.mock.calls[0].arguments[0], {
    owner: 'owner',
    repo: 'repo',
    issue_number: 42,
    assignees: ['test-user']
  });
  assert.equal(github.rest.issues.createComment.mock.calls.length, 1);
  assert.match(github.rest.issues.createComment.mock.calls[0].arguments[0].body, /unassigned from this issue/);
});

test('handleScheduledUnassign keeps user if assigned < 5 days', async () => {
  const github = createMockGithub();
  
  github.rest.issues.listForRepo = test.mock.fn(async () => [
    {
      number: 42,
      pull_request: null,
      assignees: [{ login: 'test-user' }],
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days ago
    }
  ]);

  github.rest.issues.listEventsForTimeline = test.mock.fn(async () => [
    {
      event: 'assigned',
      assignee: { login: 'test-user' },
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    }
  ]);

  const context = {
    repo: { owner: 'owner', repo: 'repo' }
  };

  await handleScheduledUnassign({ github, context });

  assert.equal(github.rest.issues.removeAssignees.mock.calls.length, 0);
  assert.equal(github.rest.issues.createComment.mock.calls.length, 0);
});
