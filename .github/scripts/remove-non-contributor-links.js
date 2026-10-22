
'use strict';

const TRUSTED_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR'
]);

function isNonContributor(association) {
  if (!association) return true;
  return !TRUSTED_ASSOCIATIONS.has(association.toUpperCase());
}

function containsLinks(text) {
  if (typeof text !== 'string' || !text) return false;

  const patterns = [
    /(?:https?|ftp):\/\/[^\s<>"')]+/i,
    /\[[^\]]+\]\((?:https?|ftp):\/\/[^\s)]+\)/i,
    /<a\s+[^>]*href=["']?(?:https?|ftp):\/\/[^"'>\s]+["']?[^>]*>.*?<\/a>/i,
    /^\[[^\]]+\]:\s*(?:https?|ftp):\/\/\S+/mi,
    /(?<!https?:\/\/|ftp:\/\/)www\.[^\s<>"')]+/i
  ];

  return patterns.some((pattern) => pattern.test(text));
}

function removeLinks(text) {
  if (typeof text !== 'string' || !text) return text;

  let sanitized = text;

  // Replace Markdown links, retaining their visible text.
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
    /(?:https?|ftp):\/\/[^\s<>"')]+/gi,
    '[link removed for security]'
  );

  // Replace www links.
  sanitized = sanitized.replace(
    /(?<!https?:\/\/|ftp:\/\/)www\.[^\s<>"')]+/gi,
    '[link removed for security]'
  );

  const notice =
    '\n\n> ⚠️ **Security Notice:** Links posted by non-contributors have been automatically removed.';

  if (!sanitized.includes('Security Notice:')) {
    sanitized += notice;
  }

  return sanitized;
}

async function run({ github, context, core }) {
  const payload = context.payload;
  const { owner, repo } = context.repo;

  // Handle issue comments.
  if (payload.comment) {
    const comment = payload.comment;

    if (!isNonContributor(comment.author_association)) {
      core.info('Comment author is trusted. Skipping.');
      return;
    }

    if (!containsLinks(comment.body)) {
      core.info('No links detected in comment. Skipping.');
      return;
    }

    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: comment.id,
      body: removeLinks(comment.body)
    });

    core.info(`Updated comment ID ${comment.id}.`);
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
      core.info('No links detected in issue. Skipping.');
      return;
    }

    await github.rest.issues.update({
      owner,
      repo,
      issue_number: issue.number,
      body: removeLinks(issue.body)
    });

    core.info(`Updated issue #${issue.number}.`);
    return;
  }

  // Handle pull request descriptions.
  if (payload.pull_request) {
    const pr = payload.pull_request;

    if (!isNonContributor(pr.author_association)) {
      core.info('Pull request author is trusted. Skipping.');
      return;
    }

    if (!containsLinks(pr.body)) {
      core.info('No links detected in pull request. Skipping.');
      return;
    }

    await github.rest.pulls.update({
      owner,
      repo,
      pull_number: pr.number,
      body: removeLinks(pr.body)
    });

    core.info(`Updated pull request #${pr.number}.`);
    return;
  }

  core.info('No supported issue, comment, or pull request payload found.');
}

async function scanAll({ github, context, core }) {
  const { owner, repo } = context.repo;

  core.info(`Starting full repository scan for ${owner}/${repo}.`);

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
      core.info(`Updated ${issue.pull_request ? 'PR' : 'issue'} #${issue.number}.`);
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
        await github.rest.issues.updateComment({
          owner,
          repo,
          comment_id: comment.id,
          body: removeLinks(comment.body)
        });

        updatedCommentCount++;
        core.info(`Updated comment ID ${comment.id}.`);
      }
    }
  }

  core.info(
    `Scan complete. Updated ${updatedIssueCount} issue/PR descriptions and ${updatedCommentCount} comments.`
  );
}

// Export the functions so require() can access cleaner.run and cleaner.scanAll.
module.exports = {
  isNonContributor,
  containsLinks,
  removeLinks,
  run,
  scanAll
};
