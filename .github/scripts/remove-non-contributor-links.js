
'use strict';

const TRUSTED_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR',
  'FIRST_TIME_CONTRIBUTOR'
]);

/**
 * Checks whether the author is a non-contributor.
 * Unknown associations are treated as untrusted data
 * and are not automatically modified.
 */
function isNonContributor(association) {
  if (typeof association !== 'string' || !association.trim()) {
    return false;
  }

  return !TRUSTED_ASSOCIATIONS.has(association.toUpperCase());
}

/**
 * Detects HTTP, HTTPS, FTP, and www links.
 */
function containsLinks(text) {
  if (typeof text !== 'string' || !text) return false;

  return (
    /(?:https?|ftp):\/\/[^\s<>"')]+/i.test(text) ||
    /\bwww\.[^\s<>"')]+/i.test(text)
  );
}

/**
 * Removes links and adds a security notice.
 */
function removeLinks(text) {
  if (typeof text !== 'string' || !text) return text;

  let sanitized = text;

  // Remove Markdown links but preserve their text.
  sanitized = sanitized.replace(
    /\[([^\]]+)\]\((?:https?|ftp):\/\/[^\s)]+\)/gi,
    '$1 [link removed for security]'
  );

  // Remove HTML anchor links but preserve their visible text.
  sanitized = sanitized.replace(
    /<a\b[^>]*\bhref\s*=\s*(?:"(?:https?|ftp):\/\/[^"]*"|'(?:https?|ftp):\/\/[^']*'|(?:https?|ftp):\/\/[^\s>]+)[^>]*>([\s\S]*?)<\/a\s*>/gi,
    '$1 [link removed for security]'
  );

  // Remove Markdown reference-style links.
  sanitized = sanitized.replace(
    /^\[([^\]]+)\]:\s*(?:https?|ftp):\/\/\S+/gmi,
    '[$1]: # [link removed for security]'
  );

  // Remove remaining raw URLs.
  sanitized = sanitized.replace(
    /(?:https?|ftp):\/\/[^\s<>"')]+/gi,
    '[link removed for security]'
  );

  // Remove www links.
  sanitized = sanitized.replace(
    /\bwww\.[^\s<>"')]+/gi,
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
 * Main handler for GitHub events.
 */
async function run({ github, context, core }) {
  const payload = context.payload;
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  // Case 1: Issue or PR comment.
  if (payload.comment) {
    const comment = payload.comment;

    if (!isNonContributor(comment.author_association)) {
      core.info('Comment author is trusted or unknown. Skipping.');
      return;
    }

    if (!containsLinks(comment.body)) {
      core.info('No links found in comment. Skipping.');
      return;
    }

    const sanitizedBody = removeLinks(comment.body);

    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: comment.id,
      body: sanitizedBody
    });

    core.info(`Successfully updated comment ${comment.id}.`);
    return;
  }

  // Case 2: Issue created or edited.
  if (payload.issue) {
    const issue = payload.issue;

    if (!isNonContributor(issue.author_association)) {
      core.info('Issue author is trusted or unknown. Skipping.');
      return;
    }

    if (!containsLinks(issue.body)) {
      core.info('No links found in issue body. Skipping.');
      return;
    }

    await github.rest.issues.update({
      owner,
      repo,
      issue_number: issue.number,
      body: removeLinks(issue.body)
    });

    core.info(`Successfully updated issue #${issue.number}.`);
    return;
  }

  // Case 3: Pull request created or edited.
  if (payload.pull_request) {
    const pr = payload.pull_request;

    if (!isNonContributor(pr.author_association)) {
      core.info('PR author is trusted or unknown. Skipping.');
      return;
    }

    if (!containsLinks(pr.body)) {
      core.info('No links found in PR body. Skipping.');
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

  core.info('No supported GitHub event found.');
}

/**
 * Scans existing issues, PRs, and comments.
 */
async function scanAll({ github, context, core }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  core.info(`Starting repository scan: ${owner}/${repo}`);

  const issues = await github.paginate(
    github.rest.issues.listForRepo,
    {
      owner,
      repo,
      state: 'all',
      per_page: 100
    }
  );

  let updatedIssueCount = 0;
  let updatedCommentCount = 0;

  for (const issue of issues) {
    try {
      // Check issue or PR description.
      if (
        isNonContributor(issue.author_association) &&
        containsLinks(issue.body)
      ) {
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

      // Check comments.
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
          await github.rest.issues.updateComment({
            owner,
            repo,
            comment_id: comment.id,
            body: removeLinks(comment.body)
          });

          updatedCommentCount++;
        }
      }
    } catch (error) {
      core.warning(
        `Could not process issue/PR #${issue.number}: ${error.message}`
      );
    }
  }

  core.info(
    `Scan complete! Updated ${updatedIssueCount} issue/PR descriptions and ${updatedCommentCount} comments.`
  );
}

module.exports = {
  isNonContributor,
  containsLinks,
  removeLinks,
  run,
  scanAll
};

