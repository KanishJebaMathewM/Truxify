
'use strict';

const BASE_URL = 'https://api.github.com';
const DAYS = 7;

function hasLinkedPullRequest(issueNumber, timeline = [], searchItems = []) {
  const inTimeline = timeline.some(event =>
    event.event === 'cross-referenced' &&
    event.source?.issue?.pull_request
  );

  if (inTimeline) return true;

  const pattern = new RegExp(
    `(?:#|issues/)${issueNumber}(?!\\d)`,
    'i'
  );

  return searchItems.some(pr =>
    pattern.test(`${pr.title || ''}\n${pr.body || ''}`)
  );
}

function getAssignmentTimestamp(issue, timeline = []) {
  const events = timeline
    .filter(e => e.event === 'assigned' && e.created_at)
    .map(e => new Date(e.created_at).getTime())
    .filter(Number.isFinite);

  // Do not guess the assignment date if history is unavailable.
  if (events.length === 0) return null;

  return Math.max(...events);
}

function hasRecentContributorActivity(
  issue,
  timeline = [],
  now = Date.now(),
  daysThreshold = DAYS
) {
  const assignees = new Set(
    (issue.assignees || []).map(a => a.login.toLowerCase())
  );

  return timeline.some(event => {
    const author =
      event.actor?.login || event.user?.login;

    if (!author || !assignees.has(author.toLowerCase())) {
      return false;
    }

    const allowedEvents = [
      'commented',
      'committed',
      'reviewed',
      'line-commented'
    ];

    if (!allowedEvents.includes(event.event)) return false;

    const eventTime = new Date(event.created_at).getTime();

    if (!Number.isFinite(eventTime)) return false;

    const days = (now - eventTime) / 86400000;

    return days >= 0 && days < daysThreshold;
  });
}

function isEligibleForUnassign({
  issue,
  timeline = [],
  searchItems = [],
  now = Date.now(),
  daysThreshold = DAYS
}) {
  if (
    !issue ||
    issue.pull_request ||
    !issue.assignees ||
    issue.assignees.length === 0
  ) {
    return { eligible: false, reason: 'no-assignees-or-pr' };
  }

  const assignedAt = getAssignmentTimestamp(issue, timeline);

  if (assignedAt === null) {
    return {
      eligible: false,
      reason: 'assignment-date-unavailable'
    };
  }

  const daysSinceAssigned = (now - assignedAt) / 86400000;

  if (daysSinceAssigned < daysThreshold) {
    return {
      eligible: false,
      reason: 'assigned-recently',
      daysSinceAssigned
    };
  }

  if (hasLinkedPullRequest(issue.number, timeline, searchItems)) {
    return {
      eligible: false,
      reason: 'pr-exists',
      daysSinceAssigned
    };
  }

  if (
    hasRecentContributorActivity(
      issue,
      timeline,
      now,
      daysThreshold
    )
  ) {
    return {
      eligible: false,
      reason: 'recent-contributor-activity',
      daysSinceAssigned
    };
  }

  return {
    eligible: true,
    daysSinceAssigned,
    assignees: issue.assignees.map(a => a.login)
  };
}

async function run({
  github,
  context,
  core = console,
  dryRun = false,
  daysThreshold = DAYS
}) {
  const { owner, repo } = context.repo;

  if (!Number.isFinite(daysThreshold) || daysThreshold <= 0) {
    throw new Error('daysThreshold must be a positive number.');
  }

  core.info(
    `Running Issue Auto-Unassigner on ${owner}/${repo}. Threshold: ${daysThreshold} days. DryRun: ${dryRun}`
  );

  const issues = await github.paginate(
    github.rest.issues.listForRepo,
    {
      owner,
      repo,
      state: 'open',
      per_page: 100
    }
  );

  const assignedIssues = issues.filter(
    issue =>
      !issue.pull_request &&
      issue.assignees?.length > 0
  );

  let unassignedCount = 0;

  for (const issue of assignedIssues) {
    try {
      // Fetch timeline
      let timeline;

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
        continue;
      }

      // Search for linked pull requests
      let searchItems;

      try {
        const result =
          await github.rest.search.issuesAndPullRequests({
            q: `repo:${owner}/${repo} is:pr ${issue.number}`
          });

        searchItems = result.data.items || [];
      } catch (error) {
        core.warning(
          `Could not search PRs for #${issue.number}: ${error.message}`
        );
        continue;
      }

      // Evaluate issue
      const evaluation = isEligibleForUnassign({
        issue,
        timeline,
        searchItems,
        now: Date.now(),
        daysThreshold
      });

      if (!evaluation.eligible) {
        core.info(
          `Skipping #${issue.number}: ${evaluation.reason}`
        );
        continue;
      }

      const assignees = evaluation.assignees;

      core.info(
        `Issue #${issue.number} is eligible for unassignment.`
      );

      if (dryRun) {
        core.info(
          `[Dry Run] Would unassign @${assignees.join(', @')} from #${issue.number}`
        );
        unassignedCount++;
        continue;
      }

      // Remove assignees
      await github.rest.issues.removeAssignees({
        owner,
        repo,
        issue_number: issue.number,
        assignees
      });

      // Remove assigned label if present
      const hasLabel = (issue.labels || []).some(
        label =>
          (typeof label === 'string'
            ? label
            : label.name
          ).toLowerCase() === 'assigned'
      );

      if (hasLabel) {
        try {
          await github.rest.issues.removeLabel({
            owner,
            repo,
            issue_number: issue.number,
            name: 'assigned'
          });
        } catch (error) {
          core.warning(
            `Could not remove assigned label from #${issue.number}: ${error.message}`
          );
        }
      }

      // Notify contributors
      const mention = assignees.map(a => `@${a}`).join(', ');

      const comment =
        `⚠️ ${mention} This issue has been automatically unassigned because there were no linked pull requests or recent updates in the last ${daysThreshold} days. It is now open for other contributors to claim!`;

      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: comment
      });

      core.info(
        `Successfully unassigned issue #${issue.number}.`
      );

      unassignedCount++;

    } catch (error) {
      core.error(
        `Failed processing issue #${issue.number}: ${error.message}`
      );
    }
  }

  core.info(
    `Issue Auto-Unassigner finished. Total issues processed for unassignment: ${unassignedCount}`
  );

  return { unassignedCount };
}

// Native fetch wrapper for standalone execution
function createFetchOctokit(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'Truxify-Issue-Unassigner'
  };

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers }
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `GitHub API HTTP ${response.status}: ${message}`
      );
    }

    // DELETE requests may return HTTP 204 with no body.
    const text = await response.text();

    return text ? JSON.parse(text) : null;
  }

  return {
    paginate: async (method, params) => {
      const results = [];
      let page = 1;

      while (true) {
        const items = await method({
          ...params,
          page,
          per_page: params.per_page || 100
        });

        if (!items || items.length === 0) break;

        results.push(...items);

        if (items.length < (params.per_page || 100)) break;

        page++;
      }

      return results;
    },

    rest: {
      issues: {
        listForRepo: params =>
          request(
            `${BASE_URL}/repos/${params.owner}/${params.repo}/issues?state=${params.state}&page=${params.page}&per_page=${params.per_page}`
          ),

        listEventsForTimeline: params =>
          request(
            `${BASE_URL}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/timeline?page=${params.page}&per_page=${params.per_page}`
          ),

        removeAssignees: params =>
          request(
            `${BASE_URL}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/assignees`,
            {
              method: 'DELETE',
              body: JSON.stringify({
                assignees: params.assignees
              })
            }
          ),

        removeLabel: params =>
          request(
            `${BASE_URL}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/labels/${encodeURIComponent(params.name)}`,
            { method: 'DELETE' }
          ),

        createComment: params =>
          request(
            `${BASE_URL}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/comments`,
            {
              method: 'POST',
              body: JSON.stringify({ body: params.body })
            }
          )
      },

      search: {
        issuesAndPullRequests: async ({ q }) => {
          const data = await request(
            `${BASE_URL}/search/issues?q=${encodeURIComponent(q)}`
          );

          return { data };
        }
      }
    }
  };
}

// Standalone CLI execution
if (require.main === module) {
  (async () => {
    const token =
      process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

    if (!token) {
      throw new Error(
        'GITHUB_TOKEN or GH_TOKEN environment variable is required.'
      );
    }

    const repoSlug =
      process.env.GITHUB_REPOSITORY ||
      'KanishJebaMathewM/Truxify';

    const [owner, repo] = repoSlug.split('/');

    if (!owner || !repo) {
      throw new Error('Invalid repository name.');
    }

    const dryRun =
      process.env.DRY_RUN === 'true' ||
      process.argv.includes('--dry-run');

    const daysThreshold = Number(
      process.env.DAYS_THRESHOLD || DAYS
    );

    const github = createFetchOctokit(token);

    await run({
      github,
      context: { repo: { owner, repo } },
      core: console,
      dryRun,
      daysThreshold
    });
  })().catch(error => {
    console.error(error.message);
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

