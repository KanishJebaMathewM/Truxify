'use strict';

const TRUSTED_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR'
]);

/**
 * Checks if the author's association indicates they are a non-contributor.
 * @param {string} association - GitHub author_association field value
 * @returns {boolean}
 */
function isNonContributor(association) {
  if (!association) return true;
  return !TRUSTED_ASSOCIATIONS.has(association.toUpperCase());
}

/**
 * Detects if text contains any links.
 * @param {string} text
 * @returns {boolean}
 */
function containsLinks(text) {
  if (!text || typeof text !== 'string') return false;
  return (
    /(?:https?|ftp):\/\/[^\s><"')]*/i.test(text) ||
    /\[([^\]]+)\]\((?:https?|ftp):\/\/[^\s)]+\)/i.test(text) ||
    /<a\s+[^>]*href=["']?(?:https?|ftp):\/\/[^"'>\s]+["']?[^>]*>(.*?)<\/a>/i.test(text) ||
    /^\[([^\]]+)\]:\s*(?:https?|ftp):\/\/\S+/mi.test(text) ||
    /(?<!https?:\/\/|ftp:\/\/)www\.[^\s><"')]*/i.test(text)
  );
}

/**
 * Removes/sanitizes links from text and adds a security notice.
 * @param {string} text
 * @returns {string}
 */
function removeLinks(text) {
  if (!text || typeof text !== 'string') return text;

  let sanitized = text;

  // Replace Markdown links [text](url) -> text [link removed for security]
  sanitized = sanitized.replace(/\[([^\]]+)\]\((?:https?|ftp):\/\/[^\s)]+\)/gi, '$1 [link removed for security]');

  // Replace HTML anchor links <a href="...">text</a> -> text [link removed for security]
  sanitized = sanitized.replace(/<a\s+[^>]*href=["']?(?:https?|ftp):\/\/[^"'>\s]+["']?[^>]*>(.*?)<\/a>/gi, '$1 [link removed for security]');

  // Replace Reference-style links [id]: http://... -> [id]: # [link removed for security]
  sanitized = sanitized.replace(/^\[([^\]]+)\]:\s*(?:https?|ftp):\/\/\S+/gmi, '[$1]: # [link removed for security]');

  // Replace remaining raw http/https/ftp URLs
  sanitized = sanitized.replace(/(?:https?|ftp):\/\/[^\s><"')]*/gi, '[link removed for security]');

  // Replace www. links
  sanitized = sanitized.replace(/(?<!https?:\/\/|ftp:\/\/)www\.[^\s><"')]*/gi, '[link removed for security]');

  const notice = '\n\n> ⚠️ **Security Notice:** Links posted by non-contributors have been automatically removed.';

  if (!sanitized.includes('Security Notice:')) {
    sanitized += notice;
  }

  return sanitized;
}

/**
 * Main handler function executed on real-time GitHub events.
 * @param {object} params
 * @param {object} params.github - GitHub Octokit REST instance
 * @param {object} params.context - GitHub context instance
 * @param {object} params.core - GitHub core instance
 */
async function run({ github, context, core }) {
  const payload = context.payload;
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  // Case 1: Issue comment (applies to comments on both Issues and Pull Requests)
  if (payload.comment) {
    const comment = payload.comment;
    const authorAssociation = comment.author_association;

    if (!isNonContributor(authorAssociation)) {
      core.info(`Comment author association '${authorAssociation}' is trusted. Skipping.`);
      return;
    }

    if (!containsLinks(comment.body)) {
      core.info('No links detected in non-contributor comment. Skipping.');
      return;
    }

    core.info(`Removing links from comment ID ${comment.id} posted by non-contributor...`);
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

  // Case 2: Issue created or edited
  if (payload.issue) {
    const issue = payload.issue;
    const authorAssociation = issue.author_association;

    if (!isNonContributor(authorAssociation)) {
      core.info(`Issue author association '${authorAssociation}' is trusted. Skipping.`);
      return;
    }

    if (!containsLinks(issue.body)) {
      core.info('No links detected in non-contributor issue body. Skipping.');
      return;
    }

    core.info(`Removing links from Issue #${issue.number} posted by non-contributor...`);
    const sanitizedBody = removeLinks(issue.body);

    await github.rest.issues.update({
      owner,
      repo,
      issue_number: issue.number,
      body: sanitizedBody
    });
    core.info(`Successfully updated Issue #${issue.number}.`);
    return;
  }

  // Case 3: Pull Request created or edited
  if (payload.pull_request) {
    const pr = payload.pull_request;
    const authorAssociation = pr.author_association;

    if (!isNonContributor(authorAssociation)) {
      core.info(`PR author association '${authorAssociation}' is trusted. Skipping.`);
      return;
    }

    if (!containsLinks(pr.body)) {
      core.info('No links detected in non-contributor PR body. Skipping.');
      return;
    }

    core.info(`Removing links from PR #${pr.number} posted by non-contributor...`);
    const sanitizedBody = removeLinks(pr.body);

    await github.rest.pulls.update({
      owner,
      repo,
      pull_number: pr.number,
      body: sanitizedBody
    });
    core.info(`Successfully updated PR #${pr.number}.`);
    return;
  }

  core.info('No issue, comment, or pull request found in event payload.');
}

/**
 * Scans all existing issues, PRs, and comments in the repository and removes links from non-contributors.
 * @param {object} params
 * @param {object} params.github - GitHub Octokit REST instance
 * @param {object} params.context - GitHub context instance
 * @param {object} params.core - GitHub core instance
 */
async function scanAll({ github, context, core }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  core.info(`Starting full repository scan for ${owner}/${repo}...`);

  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'all',
    per_page: 100
  });

  core.info(`Found ${issues.length} total issues/PRs to inspect.`);

  let updatedIssueCount = 0;
  let updatedCommentCount = 0;

  for (const issue of issues) {
    if (isNonContributor(issue.author_association) && containsLinks(issue.body)) {
      core.info(`Sanitizing body for ${issue.pull_request ? 'PR' : 'Issue'} #${issue.number}...`);
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

    const comments = await github.paginate(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number: issue.number,
      per_page: 100
    });

    for (const comment of comments) {
      if (isNonContributor(comment.author_association) && containsLinks(comment.body)) {
        core.info(`Sanitizing comment ID ${comment.id} on #${issue.number}...`);
        const sanitizedBody = removeLinks(comment.body);
        await github.rest.issues.updateComment({
          owner,
          repo,
          comment_id: comment.id,
          body: sanitizedBody
        });
        updatedCommentCount++;
      }
    }
  }

  core.info(`Scan complete! Updated ${updatedIssueCount} issue/PR descriptions and ${updatedCommentCount} comments.`);
}

module.exports = {
  isNonContributor,
  containsLinks,
  removeLinks,
  run,
  scanAll
};
