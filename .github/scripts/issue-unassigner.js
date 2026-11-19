
'use strict';

const DEFAULT_DAYS_THRESHOLD = 7;

/**
 * Checks whether a linked pull request exists in the issue timeline
 * or in the supplied PR search results.
 */
function hasLinkedPullRequest(issueNumber, timeline = [], searchItems = []) {
  // Check cross-referenced events in the timeline.
  const inTimeline = timeline.some((event) =>
    event.event === 'cross-referenced' &&
    event.source?.issue?.pull_request
  );

  if (inTimeline) return true;

  // Match references to this specific issue number.
  const issueRefPattern = new RegExp(
    `(?:#${issueNumber}\\b|issues/${issueNumber}\\b)`,
    'i'
  );

  return searchItems.some((pr) => {
    const text = `${pr.title || ''}\n${pr.body || ''}`;
    return issueRefPattern.test(text);
  });
}

/**
 * Returns the timestamp of the most recent assignment event.
 * Falls back to the issue creation date when no valid assignment event exists.
 */
function getAssignmentTimestamp(issue, timeline = []) {
  const assignEvents = timeline
    .filter(
      (event) =>
        event.event === 'assigned' &&
        event.created_at &&
        !Number.isNaN(new Date(event.created_at).getTime())
    )
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() -
        new Date(b.created_at).getTime()
    );

  if (assignEvents.length > 0) {
    return new Date(
      assignEvents[assignEvents.length - 1].created_at
    ).getTime();
  }

  const createdAt = new Date(issue.created_at).getTime();
  return Number.isNaN(createdAt) ? Date.now() : createdAt;
}

/**
 * Checks whether an assigned contributor has recent activity.
 */
function hasRecentContributorActivity(
  issue,
  timeline = [],
  now = Date.now(),
  daysThreshold = DEFAULT_DAYS_THRESHOLD
) {
  const assigneeLogins = new Set(
    (issue.assignees || [])
      .map((assignee) => assignee.login?.toLowerCase())
      .filter(Boolean)
  );

  return timeline.some((event) => {
    const author =
      (event.actor && event.actor.login) ||
      (event.user && event.user.login);

    if (!author || !assigneeLogins.has(author.toLowerCase())) {
      return false;
    }

    // Only consider relevant contributor activity.
    if (
      !['commented', 'committed', 'reviewed', 'line-commented'].includes(
        event.event
      )
    ) {
      return false;
    }

    if (!event.created_at) return false;

    const eventTime = new Date(event.created_at).getTime();
    if (Number.isNaN(eventTime)) return false;

    const daysSinceEvent = (now - eventTime) / (1000 * 60 * 60 * 24);

    return daysSinceEvent >= 0 && daysSinceEvent < daysThreshold;
  });
}

/**
 * Determines whether an issue is eligible for automatic unassignment.
 *
 * Modes:
 * - no_pr: Checks assignment age and linked PRs.
 * - no_pr_or_inactive: Also checks recent contributor activity.
 */
function isEligibleForUnassign({
  issue,
  timeline = [],
  searchItems = [],
  now = Date.now(),
  daysThreshold = DEFAULT_DAYS_THRESHOLD,
  mode = 'no_pr_or_inactive'
}) {
  if (
    !issue ||
    issue.pull_request ||
    !Array.isArray(issue.assignees) ||
    issue.assignees.length === 0
  ) {
    return { eligible: false, reason: 'no-assignees-or-pr' };
  }

  if (!['no_pr', 'no_pr_or_inactive'].includes(mode)) {
    return { eligible: false, reason: 'invalid-mode' };
  }

  // 1. Check assignment age.
  const assignedAt = getAssignmentTimestamp(issue, timeline);
  const daysSinceAssigned = (now - assignedAt) / (1000 * 60 * 60 * 24);

  if (daysSinceAssigned < daysThreshold) {
    return {
      eligible: false,
      reason: 'assigned-recently',
      daysSinceAssigned,
      daysThreshold
    };
  }

  // 2. Do not unassign if a linked PR exists.
  const hasPR = hasLinkedPullRequest(issue.number, timeline, searchItems);

  if (hasPR) {
    return {
      eligible: false,
      reason: 'pr-exists',
      daysSinceAssigned
    };
  }

  // 3. In inactive mode, check recent activity.
  if (mode === 'no_pr_or_inactive') {
    const hasContributorActivity = hasRecentContributorActivity(
      issue,
      timeline,
      now,
      daysThreshold
    );

    if (hasContributorActivity) {
      return {
        eligible: false,
        reason: 'recent-contributor-activity',
        daysSinceAssigned
      };
    }
  }

  return {
    eligible: true,
    daysSinceAssigned,
    assignees: issue.assignees.map((assignee) => assignee.login)
  };
}

/**
 * Main execution function for GitHub Actions or CLI usage.
 */
async function run({
  github,
  context,
  core = console,
  dryRun = false,
  daysThreshold = DEFAULT_DAYS_THRESHOLD,
  mode = 'no_pr_or_inactive'
}) {
  const { owner, repo } = context.repo;

  core.info(
    `Running Issue Auto-Unassigner on ${owner}/${repo} ` +
    `(Mode: ${mode}, Threshold: ${daysThreshold} days, DryRun: ${dryRun})`
  );

  // Fetch all open issues.
  const openIssues = await github.paginate(
    github.rest.issues.listForRepo,
    {
      owner,
      repo,
      state: 'open',
      per_page: 100
    }
  );

  const assignedIssues = openIssues.filter(
    (issue) =>
      !issue.pull_request &&
      Array.isArray(issue.assignees) &&
      issue.assignees.length > 0
  );

  core.info(
    `Found ${assignedIssues.length} open assigned issue(s) to evaluate.`
  );

  let unassignedCount = 0;

  for (const issue of assignedIssues) {
    try {
      // 1. Fetch timeline events.
      let timeline = [];

      try {
        timeline = await github.paginate(
          github.rest.issues.listEventsForTimeline,
          {
            owner,
            repo,
            issue_number: issue.number,
            per_page: 100
          }
        );
      } catch (error) {
        core.warning(
          `Could not fetch timeline for #${issue.number}: ${error.message}`
        );
      }

      // 2. Fetch PR search results for the repository.
      let searchItems = [];

      try {
        const searchRes = await github.rest.search.issuesAndPullRequests({
          q: `repo:${owner}/${repo} is:pr`
        });

        searchItems =
          (searchRes && searchRes.data && searchRes.data.items) || [];
      } catch (error) {
        core.debug(
          `Search API query failed for #${issue.number}: ${error.message}`
        );
      }

      // 3. Evaluate the issue.
      const evaluation = isEligibleForUnassign({
        issue,
        timeline,
        searchItems,
        now: Date.now(),
        daysThreshold,
        mode
      });

      if (!evaluation.eligible) {
        core.info(
          `Skipping #${issue.number}: ${evaluation.reason} ` +
          `(assigned: ${
            evaluation.daysSinceAssigned
              ? evaluation.daysSinceAssigned.toFixed(1)
              : 0
          }d)`
        );
        continue;
      }

      const assignees = evaluation.assignees;

      core.info(
        `Issue #${issue.number} assigned to @${assignees.join(', @')} ` +
        `has had no linked PR or qualifying updates.`
      );

      // 4. Handle dry-run mode.
      if (dryRun) {
        core.info(
          `[Dry Run] Would unassign @${assignees.join(', @')} ` +
          `from issue #${issue.number}`
        );
        unassignedCount++;
        continue;
      }

      // 5. Remove assignees.
      await github.rest.issues.removeAssignees({
        owner,
        repo,
        issue_number: issue.number,
        assignees
      });

      // 6. Remove the assigned label if present.
      const hasAssignedLabel = (issue.labels || []).some((label) => {
        const name = typeof label === 'string' ? label : label.name;
        return name && name.toLowerCase() === 'assigned';
      });

      if (hasAssignedLabel) {
        try {
          await github.rest.issues.removeLabel({
            owner,
            repo,
            issue_number: issue.number,
            name: 'assigned'
          });
        } catch (error) {
          core.debug(
            `Could not remove 'assigned' label from #${issue.number}: ` +
            error.message
          );
        }
      }

      // 7. Post a notification comment.
      const mentionText = assignees.map((user) => `@${user}`).join(', ');
      const commentBody =
        `⚠️ ${mentionText} This issue has been automatically unassigned ` +
        `because there were no linked pull requests or qualifying updates ` +
        `within the last ${daysThreshold} days. It is now open for other ` +
        `contributors to claim!`;

      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: commentBody
      });

      core.info(
        `Successfully unassigned @${assignees.join(', ')} ` +
        `from issue #${issue.number}`
      );

      unassignedCount++;
    } catch (error) {
      core.error(
        `Failed processing issue #${issue.number}: ${error.message}`
      );
    }
  }

  core.info(
    `Issue Auto-Unassigner finished. Total issues unassigned: ${unassignedCount}`
  );

  return { unassignedCount };
}

/**
 * Creates a lightweight Octokit-compatible wrapper around native fetch.
 */
function createFetchOctokit(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Truxify-Issue-Unassigner',
    'Content-Type': 'application/json'
  };

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers }
    });

    if (!response.ok) {
      const responseText = await response.text();
      const error = new Error(
        `GitHub API HTTP ${response.status}: ${responseText}`
      );
      error.status = response.status;
      throw error;
    }

    // Handle API responses that contain no body (e.g. HTTP 204).
    if (response.status === 204) return null;

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    paginate: async (method, params) => {
      let page = 1;
      const results = [];
      const perPage = params.per_page || 100;

      while (true) {
        const items = await method({ ...params, page, per_page: perPage });

        if (!Array.isArray(items) || items.length === 0) break;

        results.push(...items);

        if (items.length < perPage) break;
        page++;
      }

      return results;
    },

    rest: {
      issues: {
        listForRepo: async ({ owner, repo, state, page, per_page }) =>
          request(
            `https://api.github.com/repos/${owner}/${repo}/issues` +
            `?state=${state}&page=${page}&per_page=${per_page}`
          ),

        listEventsForTimeline: async ({
          owner,
          repo,
          issue_number,
          page,
          per_page
        }) =>
          request(
            `https://api.github.com/repos/${owner}/${repo}/issues/` +
            `${issue_number}/timeline?page=${page}&per_page=${per_page}`
          ),

        removeAssignees: async ({
          owner,
          repo,
          issue_number,
          assignees
        }) =>
          request(
            `https://api.github.com/repos/${owner}/${repo}/issues/` +
            `${issue_number}/assignees`,
            {
              method: 'DELETE',
              body: JSON.stringify({ assignees })
            }
          ),

        removeLabel: async ({ owner, repo, issue_number, name }) =>
          request(
            `https://api.github.com/repos/${owner}/${repo}/issues/` +
            `${issue_number}/labels/${encodeURIComponent(name)}`,
            { method: 'DELETE' }
          ),

        createComment: async ({ owner, repo, issue_number, body }) =>
          request(
            `https://api.github.com/repos/${owner}/${repo}/issues/` +
            `${issue_number}/comments`,
            {
              method: 'POST',
              body: JSON.stringify({ body })
            }
          )
      },

      search: {
        issuesAndPullRequests: async ({ q }) => {
          const data = await request(
            `https://api.github.com/search/issues?q=${encodeURIComponent(q)}`
          );
          return { data };
        }
      }
    }
  };
}

// Standalone CLI execution support.
if (require.main === module) {
  (async () => {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

    if (!token) {
      console.error(
        'Error: GITHUB_TOKEN or GH_TOKEN environment variable is required.'
      );
      console.error(
        'Usage: GITHUB_TOKEN=xxx [DRY_RUN=true] ' +
        '[DAYS_THRESHOLD=7] node .github/scripts/issue-unassigner.js'
      );
      process.exitCode = 1;
      return;
    }

    const repoSlug =
      process.env.GITHUB_REPOSITORY || 'KanishJebaMathewM/Truxify';

    const [owner, repo] = repoSlug.split('/');

    if (!owner || !repo) {
      console.error('Error: GITHUB_REPOSITORY must be in owner/repo format.');
      process.exitCode = 1;
      return;
    }

    const dryRun =
      process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

    const parsedThreshold = Number(
      process.env.DAYS_THRESHOLD || DEFAULT_DAYS_THRESHOLD
    );

    const daysThreshold =
      Number.isFinite(parsedThreshold) && parsedThreshold > 0
        ? parsedThreshold
        : DEFAULT_DAYS_THRESHOLD;

    const mode = process.env.MODE || 'no_pr_or_inactive';
    const github = createFetchOctokit(token);

    await run({
      github,
      context: { repo: { owner, repo } },
      core: console,
      dryRun,
      daysThreshold,
      mode
    });
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  hasLinkedPullRequest,
  getAssignmentTimestamp,
  hasRecentContributorActivity,
  isEligibleForUnassign,
  createFetchOctokit,
  run
};
