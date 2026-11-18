
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isNonContributor,
  containsLinks,
  removeLinks,
  run,
  scanAll
} = require('./remove-non-contributor-links');

// Test 1: Author association checking
test('isNonContributor correctly classifies author associations', () => {
  assert.equal(isNonContributor('OWNER'), false);
  assert.equal(isNonContributor('MEMBER'), false);
  assert.equal(isNonContributor('COLLABORATOR'), false);
  assert.equal(isNonContributor('CONTRIBUTOR'), false);
  assert.equal(isNonContributor('FIRST_TIME_CONTRIBUTOR'), false);

  assert.equal(isNonContributor('NONE'), true);
  assert.equal(isNonContributor('FIRST_TIMER'), true);

  assert.equal(isNonContributor(undefined), false);
  assert.equal(isNonContributor(null), false);
});

// Test 2: Link detection
test('containsLinks detects raw, Markdown, HTML, and reference links', () => {
  assert.equal(containsLinks('http://example.com'), true);
  assert.equal(containsLinks('https://example.com'), true);
  assert.equal(containsLinks('ftp://example.com'), true);

  assert.equal(
    containsLinks('Visit [website](https://example.com)'),
    true
  );

  assert.equal(
    containsLinks('<a href="https://example.com">Click</a>'),
    true
  );

  assert.equal(
    containsLinks('[ref]: http://example.com'),
    true
  );

  assert.equal(containsLinks('Visit www.example.com'), true);

  assert.equal(containsLinks('Issue #123 and PR #45'), false);
  assert.equal(containsLinks('Plain text without URLs'), false);
  assert.equal(containsLinks(''), false);
  assert.equal(containsLinks(null), false);
});

// Test 3: Link removal
test('removeLinks removes links and adds security notice', () => {
  const markdownText =
    'Visit [my website](https://malicious.com) for updates.';

  const markdownResult = removeLinks(markdownText);

  assert.equal(markdownResult.includes('https://malicious.com'), false);
  assert.equal(
    markdownResult.includes('my website [link removed for security]'),
    true
  );
  assert.equal(markdownResult.includes('Security Notice:'), true);

  const rawText =
    'Download here: http://danger.xyz/app.exe and https://badsite.org';

  const rawResult = removeLinks(rawText);

  assert.equal(rawResult.includes('http://danger.xyz/app.exe'), false);
  assert.equal(rawResult.includes('https://badsite.org'), false);
  assert.equal(rawResult.includes('[link removed for security]'), true);

  const htmlText =
    'Click <a href="https://phishing.com/login">here to login</a>';

  const htmlResult = removeLinks(htmlText);

  assert.equal(htmlResult.includes('https://phishing.com/login'), false);
  assert.equal(
    htmlResult.includes('here to login [link removed for security]'),
    true
  );

  const wwwResult = removeLinks('Visit www.example.com');

  assert.equal(wwwResult.includes('www.example.com'), false);
});

// Test 4: Trusted contributor comment is skipped
test('run skips comments from trusted contributors', async () => {
  let updateCommentCalled = false;

  const mockGithub = {
    rest: {
      issues: {
        updateComment: async () => {
          updateCommentCalled = true;
        }
      }
    }
  };

  const mockContext = {
    repo: { owner: 'test-owner', repo: 'test-repo' },
    payload: {
      comment: {
        id: 101,
        author_association: 'MEMBER',
        body: 'Visit https://official-docs.com'
      }
    }
  };

  const mockCore = {
    info: () => {}
  };

  await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore
  });

  assert.equal(updateCommentCalled, false);
});

// Test 5: Non-contributor comment is updated
test('run removes links from non-contributor comments', async () => {
  let updatedCommentBody = '';

  const mockGithub = {
    rest: {
      issues: {
        updateComment: async ({ comment_id, body }) => {
          assert.equal(comment_id, 202);
          updatedCommentBody = body;
        }
      }
    }
  };

  const mockContext = {
    repo: { owner: 'test-owner', repo: 'test-repo' },
    payload: {
      comment: {
        id: 202,
        author_association: 'NONE',
        body: 'Download from http://virus-link.com/file.exe'
      }
    }
  };

  const mockCore = {
    info: () => {}
  };

  await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore
  });

  assert.equal(
    updatedCommentBody.includes('http://virus-link.com/file.exe'),
    false
  );
  assert.equal(
    updatedCommentBody.includes('[link removed for security]'),
    true
  );
  assert.equal(updatedCommentBody.includes('Security Notice:'), true);
});

// Test 6: Non-contributor issue is updated
test('run removes links from non-contributor issue bodies', async () => {
  let updatedIssueBody = '';

  const mockGithub = {
    rest: {
      issues: {
        update: async ({ issue_number, body }) => {
          assert.equal(issue_number, 55);
          updatedIssueBody = body;
        }
      }
    }
  };

  const mockContext = {
    repo: { owner: 'test-owner', repo: 'test-repo' },
    payload: {
      issue: {
        number: 55,
        author_association: 'FIRST_TIMER',
        body: 'Report bug at https://fake-support.com'
      }
    }
  };

  const mockCore = {
    info: () => {}
  };

  await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore
  });

  assert.equal(
    updatedIssueBody.includes('https://fake-support.com'),
    false
  );
  assert.equal(
    updatedIssueBody.includes('[link removed for security]'),
    true
  );
});

// Test 7: Non-contributor PR is updated
test('run removes links from non-contributor PR bodies', async () => {
  let updatedPrBody = '';

  const mockGithub = {
    rest: {
      pulls: {
        update: async ({ pull_number, body }) => {
          assert.equal(pull_number, 77);
          updatedPrBody = body;
        }
      }
    }
  };

  const mockContext = {
    repo: { owner: 'test-owner', repo: 'test-repo' },
    payload: {
      pull_request: {
        number: 77,
        author_association: 'FIRST_TIMER',
        body: 'See image: https://untrusted-image-host.net/pic.png'
      }
    }
  };

  const mockCore = {
    info: () => {}
  };

  await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore
  });

  assert.equal(
    updatedPrBody.includes('https://untrusted-image-host.net/pic.png'),
    false
  );
  assert.equal(
    updatedPrBody.includes('[link removed for security]'),
    true
  );
});

// Test 8: Full repository scan
test('scanAll cleans non-contributor issue, PR, and comment links', async () => {
  const updatedIssues = [];
  const updatedComments = [];

  const mockGithub = {
    paginate: async (fn, params) => {
      if (fn === mockGithub.rest.issues.listForRepo) {
        return [
          {
            number: 1,
            author_association: 'NONE',
            body: 'Issue with http://spam1.com'
          },
          {
            number: 2,
            author_association: 'MEMBER',
            body: 'Trusted issue with https://trusted.com'
          },
          {
            number: 3,
            author_association: 'FIRST_TIMER',
            body: 'PR with http://spam2.com',
            pull_request: { url: 'https://api.github.com/pulls/3' }
          }
        ];
      }

      if (fn === mockGithub.rest.issues.listComments) {
        if (params.issue_number === 1) {
          return [
            {
              id: 10,
              author_association: 'NONE',
              body: 'Comment with http://spam-comment.com'
            },
            {
              id: 11,
              author_association: 'OWNER',
              body: 'Owner comment with https://safe.com'
            }
          ];
        }

        return [];
      }

      return [];
    },

    rest: {
      issues: {
        listForRepo: () => {},
        listComments: () => {},

        update: async ({ issue_number, body }) => {
          updatedIssues.push({ issue_number, body });
        },

        updateComment: async ({ comment_id, body }) => {
          updatedComments.push({ comment_id, body });
        }
      },

      pulls: {
        update: async ({ pull_number, body }) => {
          updatedIssues.push({ pull_number, body });
        }
      }
    }
  };

  const mockContext = {
    repo: { owner: 'test-owner', repo: 'test-repo' }
  };

  const mockCore = {
    info: () => {},
    warning: () => {}
  };

  await scanAll({
    github: mockGithub,
    context: mockContext,
    core: mockCore
  });

  // Two descriptions should be updated.
  assert.equal(updatedIssues.length, 2);

  assert.equal(updatedIssues[0].issue_number, 1);
  assert.equal(updatedIssues[0].body.includes('http://spam1.com'), false);

  assert.equal(updatedIssues[1].pull_number, 3);
  assert.equal(updatedIssues[1].body.includes('http://spam2.com'), false);

  // Only the non-contributor comment should be updated.
  assert.equal(updatedComments.length, 1);
  assert.equal(updatedComments[0].comment_id, 10);

  assert.equal(
    updatedComments[0].body.includes('http://spam-comment.com'),
    false
  );
});

