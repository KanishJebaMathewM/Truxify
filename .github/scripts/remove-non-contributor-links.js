
'use strict';

const TRUSTED_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR'
]);

/**
 * Checks whether the author's association indicates a non-contributor.
 * @param {string} association
 * @returns {boolean}
 */
function isNonContributor(association) {
  if (!association) return true;
  return !TRUSTED_ASSOCIATIONS.has(association.toUpperCase());
}

/**
 * Detects whether text contains links.
 * @param {string} text
 * @returns {boolean}
 */
function containsLinks(text) {
  if (!text || typeof text !== 'string') return false;

  return (
    /(?:https?|ftp):\/\/[^\s><"')]+/i.test(text) ||
    /\[[^\]]+\]\((?:https?|ftp):\/\/[^\s)]+\)/i.test(text) ||
    /<a\s+[^>]*href=["']?(?:https?|ftp):\/\/[^"'>\s]+["']?[^>]*>.*?<\/a>/i.test(text) ||
    /^\[[^\]]+\]:\s*(?:https?|ftp):\/\/\S+/mi.test(text) ||
    /(?<!https?:\/\/|ftp:\/\/)www\.[^\s><"')]+/i.test(text)
  );
}

/**
 * Removes links and adds a security notice.
 * @param {string} text
 * @returns {string}
 */
function removeLinks(text) {
  if (!text || typeof text !== 'string') return text;

  let sanitized = text;

  // Replace Markdown links with their visible text.
  sanitized = sanitized.replace(
    /\[([^\]]+)\]\((?:https?|ftp):\/\/[^\s)]+\)/gi,
    '$1 [link removed for security]'
  );

  // Replace HTML anchor links.
  sanitized = sanitized.replace(
    /<a\s+[^>]*href=["']?(?:https?|ftp):\/\/[^"'>\s]+["']?[^>]*>(.*?)<\/a>/gi,
    '$1 [link removed for security]'
  );

  // Replace reference-style links.
  sanitized = sanitized.replace(
    /^\[([^\]]+)\]:\s*(?:https?|ftp):\/\/\S+/gmi,
    '[$1]: # [link removed for security]'
  );

  // Replace remaining raw URLs.
  sanitized = sanitized.replace(
    /(?:https?|ftp):\/\/[^\s><"')]+/gi,
    '[link removed for security]'
  );

  // Replace www links not already matched as full URLs.
  sanitized = sanitized.replace(
    /(?<!https?:\/\/|ftp:\/\/)www\.[^\s><"')]+/gi,
    '[link removed for security]'
  );

  const notice =
    '\n\n> ⚠️ **Security Notice:** Links posted by non-contributors have been automatically removed.';

  if (!sanitized.includes('Security Notice:')) {
    sanitized += notice;
  }

  return sanitized;
}

/**
 * Handles real-time issue, PR, and comment events.
 * @param {object} params
 * @param {object} params.github
 * @param {object} params.context
 * @param {object} params.core
 */
async function run({ github, context, core }) {
  const payload = context.payload;
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  // Handle issue comments.
  if (payload.comment) {
    const comment = payload.comment;

    if (!isNonContributor(comment.author_association)) {
      core.info('Comment author is trusted. Skipping.');
      return;
    }

    if (!containsLinks(comment.body)) {
      core.info('No links detected in non-contributor comment. Skipping.');
      return;
    }

    const sanitizedBody = removeLinks(comment.body);

    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: comment.id,
      body: sanitizedBody
    });

    core.info(`Successfully updated comment ID ${comment.id}.`);
    return;
  }

  // Handle issue descriptions.
  if (payload.issue) {
    const issue = payload.issue;

    if (!isNonContributor(issue.author_association)) {
      core.info('Issue author is trusted. Skipping.');
      return;
    }

    if (!containsLinks(issue.body)) {
      core.info('No links detected in issue body. Skipping.');
      return;
    }

    await github.rest.issues.update({
      owner,
      repo,
      issue_number: issue.number,
      body: removeLinks(issue.body)
    });

    core.info(`Successfully updated Issue #${issue.number}.`);
    return;
  }

  // Handle pull request descriptions.
  if (payload.pull_request) {
    const pr = payload.pull_request;

    if (!isNonContributor(pr.author_association)) {
      core.info('PR author is trusted. Skipping.');
      return;
    }

    if (!containsLinks(pr.body)) {
      core.info('No links detected in PR body. Skipping.');
      return;
    }

    await github.rest.pulls.update({
      owner,
      repo,
      pull_number: pr.number,
      body: removeLinks(pr.body)
    });

    core.info(`Successfully updated PR #${pr.number}.`);
    return;
  }

  core.info('No issue, comment, or pull request found in event payload.');
}

/**
 * Scans existing issues, PRs, and comments.
 * @param {object} params
 * @param {object} params.github
 * @param {object} params.context
 * @param {object} params.core
 */
async function scanAll({ github, context, core }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  core.info(`Starting full repository scan for ${owner}/${repo}...`);

  const issues = await github.paginate(
    github.rest.issues.listForRepo,
    {
      owner,
      repo,
      state: 'all',
      per_page: 100
    }
  );

  core.info(`Found ${issues.length} issues/PRs to inspect.`);

  let updatedIssueCount = 0;
  let updatedCommentCount = 0;

  for (const issue of issues) {
    if (
      isNonContributor(issue.author_association) &&
      containsLinks(issue.body)
    ) {
      core.info(
        `Sanitizing ${issue.pull_request ? 'PR' : 'Issue'} #${issue.number}...`
      );

      const sanitizedBody = removeLinks(issue.body);

      if (issue.pull_request) {
        await github.rest.pulls.update({
          owner,
          repo,
          pull_number: issue.number,
          body: sanitizedBody
        });
      } else {
        await github.rest.issues.update({
          owner,
          repo,
          issue_number: issue.number,
          body: sanitizedBody
        });
      }

      updatedIssueCount++;
    }

    const comments = await github.paginate(
      github.rest.issues.listComments,
      {
        owner,
        repo,
        issue_number: issue.number,
        per_page: 100
      }
    );

    for (const comment of comments) {
      if (
        isNonContributor(comment.author_association) &&
        containsLinks(comment.body)
      ) {
        core.info(
          `Sanitizing comment ID ${comment.id} on #${issue.number}...`
        );

        await github.rest.issues.updateComment({
          owner,
          repo,
          comment_id: comment.id,
          body: removeLinks(comment.body)
        });

        updatedCommentCount++;
      }
    }
  }

  core.info(
    `Scan complete! Updated ${updatedIssueCount} issue/PR descriptions and ${updatedCommentCount} comments.`
  );
}

// Correct CommonJS exports so require() receives these functions.
module.exports = {
  isNonContributor,
  containsLinks,
  removeLinks,
  run,
  scanAll
};
