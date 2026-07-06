'use strict';

/**
 * Checks if the assignee has submitted a PR for the given issue.
 */
async function hasSubmittedPR(github, owner, repo, issueNumber, assignee, timeline) {
  try {
    // 1. Search for pull requests authored by the assignee in this repo that mention the issue number
    const q = `repo:${owner}/${repo} is:pr author:${assignee} ${issueNumber}`;
    const searchResults = await github.rest.search.issuesAndPullRequests({ q });
    if (searchResults.data.total_count > 0) {
      return true;
    }
  } catch (error) {
    console.error(`Error searching PRs for issue #${issueNumber}:`, error);
  }

  // 2. Check timeline for cross-referenced pull requests by the assignee
  if (timeline) {
    const hasTimelinePR = timeline.some(e => {
      if (e.event === 'cross-referenced' && e.source?.issue?.pull_request) {
        const prAuthor = e.source.issue.user?.login;
        if (prAuthor === assignee) {
          return true;
        }
      }
      return false;
    });
    if (hasTimelinePR) return true;
  }

  return false;
}

/**
 * Handle issue opened: limit open issues created by user to 5.
 */
async function handleIssueOpened({ github, context }) {
  const opener = context.payload.issue.user.login;
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const issueNumber = context.payload.issue.number;

  console.log(`Processing opened issue #${issueNumber} by user ${opener}`);

  // Query number of open issues created by the opener in this repository
  const q = `is:issue repo:${owner}/${repo} author:${opener} is:open`;
  const searchResults = await github.rest.search.issuesAndPullRequests({ q });
  const openIssuesCount = searchResults.data.total_count;

  console.log(`User ${opener} has ${openIssuesCount} open issues`);

  if (openIssuesCount > 5) {
    console.log(`Closing issue #${issueNumber} because user exceeded open issue limit of 5`);
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `@${opener}, you cannot have more than 5 open issues in this repository at the same time. This issue has been automatically closed.`
    });

    await github.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      state: 'closed'
    });
  }
}

/**
 * Handle issue assigned: limit open issues assigned to user to 3.
 */
async function handleIssueAssigned({ github, context }) {
  const assignee = context.payload.assignee.login;
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const issueNumber = context.payload.issue.number;

  console.log(`Processing issue assignment for #${issueNumber} to user ${assignee}`);

  // Query open issues assigned to the user
  const q = `is:issue repo:${owner}/${repo} assignee:${assignee} is:open`;
  const searchResults = await github.rest.search.issuesAndPullRequests({ q });
  const assignedCount = searchResults.data.total_count;

  console.log(`User ${assignee} has ${assignedCount} assigned open issues`);

  if (assignedCount > 3) {
    console.log(`Removing assignee ${assignee} from issue #${issueNumber} because user exceeded assignment limit of 3`);
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `@${assignee}, you cannot be assigned to more than 3 open issues at the same time. This assignment has been removed.`
    });

    await github.rest.issues.removeAssignees({
      owner,
      repo,
      issue_number: issueNumber,
      assignees: [assignee]
    });
  }
}

/**
 * Handle issue comment created: auto-assign to commenters who use .take or /assign.
 */
async function handleIssueCommentCreated({ github, context }) {
  const commentBody = context.payload.comment.body.trim();
  const commenter = context.payload.comment.user.login;
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const issueNumber = context.payload.issue.number;
  const issue = context.payload.issue;

  // Ignore comments on pull requests
  if (issue.pull_request) {
    return;
  }

  if (commentBody === '.take' || commentBody === '/assign') {
    console.log(`User ${commenter} requested assignment via comment '${commentBody}' on issue #${issueNumber}`);

    // Check if user is already assigned to this issue
    if (issue.assignees && issue.assignees.some(a => a.login === commenter)) {
      console.log(`User ${commenter} is already assigned to issue #${issueNumber}`);
      return;
    }

    // Check if the issue is already assigned to someone else
    if (issue.assignees && issue.assignees.length > 0) {
      console.log(`Issue #${issueNumber} is already assigned to ${issue.assignees[0].login}`);
      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `@${commenter}, this issue is already assigned to @${issue.assignees[0].login}.`
      });
      return;
    }

    // Check their assignment limit
    const q = `is:issue repo:${owner}/${repo} assignee:${commenter} is:open`;
    const searchResults = await github.rest.search.issuesAndPullRequests({ q });
    const assignedCount = searchResults.data.total_count;

    if (assignedCount >= 3) {
      console.log(`User ${commenter} cannot take issue #${issueNumber} because they are already assigned to ${assignedCount} open issues`);
      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `@${commenter}, you cannot be assigned to more than 3 open issues at the same time. Please resolve your existing assignments first.`
      });
      return;
    }

    // Assign them
    await github.rest.issues.addAssignees({
      owner,
      repo,
      issue_number: issueNumber,
      assignees: [commenter]
    });

    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `@${commenter} has been successfully assigned to this issue. Please submit a PR within 5 days.`
    });
  }
}

/**
 * Handle scheduled cron run: unassign users assigned for >= 5 days without a PR.
 */
async function handleScheduledUnassign({ github, context }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  console.log(`Starting scheduled unassignment check for repository ${owner}/${repo}`);

  // Fetch all open issues in the repository
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'open'
  });

  // Filter for actual issues (excluding PRs) that have assignees
  const openIssues = issues.filter(issue => !issue.pull_request && issue.assignees && issue.assignees.length > 0);
  console.log(`Found ${openIssues.length} open assigned issues to check`);

  for (const issue of openIssues) {
    for (const assignee of issue.assignees) {
      console.log(`Checking assignee ${assignee.login} on issue #${issue.number}`);

      // Fetch the timeline of events for this issue
      const timeline = await github.paginate(github.rest.issues.listEventsForTimeline, {
        owner,
        repo,
        issue_number: issue.number
      });

      // Find the latest assignment event for this assignee
      const assignEvents = timeline.filter(e => e.event === 'assigned' && e.assignee?.login === assignee.login);
      
      let assignedAt;
      if (assignEvents.length > 0) {
        assignedAt = new Date(assignEvents[assignEvents.length - 1].created_at);
      } else {
        assignedAt = new Date(issue.created_at);
      }

      const now = new Date();
      const diffTime = Math.abs(now - assignedAt);
      const diffDays = diffTime / (1000 * 60 * 60 * 24);

      console.log(`Assignee ${assignee.login} has been assigned to #${issue.number} for ${diffDays.toFixed(2)} days`);

      if (diffDays >= 5) {
        // Check if assignee has submitted a PR referencing this issue
        const submitted = await hasSubmittedPR(github, owner, repo, issue.number, assignee.login, timeline);
        if (!submitted) {
          console.log(`Unassigning ${assignee.login} from issue #${issue.number} due to 5 days without PR`);
          
          await github.rest.issues.createComment({
            owner,
            repo,
            issue_number: issue.number,
            body: `@${assignee.login}, you have been unassigned from this issue because you did not submit a PR within 5 days.`
          });

          await github.rest.issues.removeAssignees({
            owner,
            repo,
            issue_number: issue.number,
            assignees: [assignee.login]
          });
        } else {
          console.log(`Assignee ${assignee.login} has submitted a PR referencing issue #${issue.number}, keeping assigned.`);
        }
      }
    }
  }
}

module.exports = {
  hasSubmittedPR,
  handleIssueOpened,
  handleIssueAssigned,
  handleIssueCommentCreated,
  handleScheduledUnassign
};
