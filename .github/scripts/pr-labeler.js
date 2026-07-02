'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_RULES_PATH = path.join(__dirname, '..', 'pr-labeler-rules.json');

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function loadRules(rulesPath = DEFAULT_RULES_PATH) {
  return JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
}

function hasProgramSignal({ title = '', body = '', rules }) {
  const source = normalize(`${title}\n${body}`);
  return (rules.programSignals || []).some((signal) => source.includes(normalize(signal)));
}

function findLinkedIssueNumbers(text = '') {
  const issueNumbers = new Set();
  const closingKeyword =
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+)\b/gi;

  let match;
  while ((match = closingKeyword.exec(text)) !== null) {
    issueNumbers.add(Number(match[1]));
  }

  return [...issueNumbers].filter(Number.isInteger);
}

function addLabels(target, labels) {
  for (const label of labels || []) {
    if (label) target.add(label);
  }
}

function labelsMatchingRules(value, rules = []) {
  const labels = new Set();
  for (const rule of rules) {
    const pattern = new RegExp(rule.pattern, 'i');
    if (pattern.test(value)) {
      addLabels(labels, rule.labels);
    }
  }
  return labels;
}

function selectLabels({
  prTitle = '',
  prBody = '',
  changedFiles = [],
  linkedIssueLabels = [],
  currentLabels = [],
  availableLabels = [],
  rules = loadRules(),
  detectedPrograms = []
}) {
  const selected = new Set();
  const current = new Set(currentLabels.map(normalize));
  const available = new Set(availableLabels.map(normalize));
  const inherited = new Set((rules.inheritLabels || []).map(normalize));

  for (const label of linkedIssueLabels) {
    if (inherited.has(normalize(label))) {
      selected.add(label);
    }
  }

  // Determine program from title/body or passed detections
  const programs = new Set(detectedPrograms);
  const combinedText = `${prTitle}\n${prBody}`.toLowerCase();
  if (combinedText.includes('gssoc')) {
    programs.add('gssoc');
  }
  if (combinedText.includes('ecsoc')) {
    programs.add('ecsoc');
  }

  // Apply program labels based on the detected program(s)
  if (programs.has('gssoc')) {
    addLabels(selected, rules.programLabels || ['gssoc:approved']);
  }
  if (programs.has('ecsoc')) {
    addLabels(selected, ['ECSoC26']);
  }

  addLabels(selected, labelsMatchingRules(prTitle, rules.titleRules));

  for (const file of changedFiles) {
    addLabels(selected, labelsMatchingRules(file, rules.pathRules));
  }

  return [...selected]
    .filter((label) => available.has(normalize(label)))
    .filter((label) => !current.has(normalize(label)))
    .sort((a, b) => a.localeCompare(b));
}

async function fetchPaginatedLabels(github, owner, repo) {
  const labels = await github.paginate(github.rest.issues.listLabelsForRepo, {
    owner,
    repo,
    per_page: 100
  });
  return labels.map((label) => label.name);
}

async function fetchPullRequestFiles(github, owner, repo, pullNumber) {
  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100
  });
  return files.map((file) => file.filename);
}

async function fetchIssueLabels(github, owner, repo, issueNumbers) {
  const labels = new Set();
  for (const issueNumber of issueNumbers) {
    try {
      const response = await github.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber
      });
      addLabels(
        labels,
        (response.data.labels || []).map((label) =>
          typeof label === 'string' ? label : label.name
        )
      );
    } catch (error) {
      // Missing or cross-repository issue references should not block PR labeling.
      continue;
    }
  }
  return [...labels];
}

async function ensureLabelExists(github, owner, repo, name, color, description) {
  try {
    await github.rest.issues.createLabel({
      owner,
      repo,
      name,
      color,
      description
    });
  } catch (error) {
    if (error.status !== 422) {
      throw error;
    }
  }
}

async function run({ github, context, core, rulesPath = DEFAULT_RULES_PATH, dryRun = false }) {
  const { owner, repo } = context.repo;

  let pullRequest = context.payload.pull_request;
  if (!pullRequest) {
    if (context.payload.issue && context.payload.issue.pull_request) {
      core.info(`Triggered by comment on PR #${context.payload.issue.number}. Fetching PR details...`);
      const response = await github.rest.pulls.get({
        owner,
        repo,
        pull_number: context.payload.issue.number
      });
      pullRequest = response.data;
    } else {
      core.info('No pull_request payload found and not an issue comment on a PR; skipping PR labeler.');
      return [];
    }
  } else {
    core.info(`Fetching latest PR details for PR #${pullRequest.number}...`);
    const response = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullRequest.number
    });
    pullRequest = response.data;
  }

  const pullNumber = pullRequest.number;
  const rules = loadRules(rulesPath);

  // Fetch comments to scan for GSSOC or ECSoC mentions and the automated message
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 100
  });

  const AUTOMATED_COMMENT_BODY = 'Are you a part of GSSOC or ECSoC?';
  const hasAutomatedComment = comments.some(c => c.body && c.body.includes(AUTOMATED_COMMENT_BODY));
  const otherComments = comments.filter(c => !(c.body && c.body.includes(AUTOMATED_COMMENT_BODY)));

  // Combine title, body, and all comments (excluding the automated comment) for program detection
  let searchSource = `${pullRequest.title}\n${pullRequest.body || ''}`;
  for (const c of otherComments) {
    searchSource += `\n${c.body || ''}`;
  }
  searchSource = searchSource.toLowerCase();

  const hasGssoc = searchSource.includes('gssoc');
  const hasEcsoc = searchSource.includes('ecsoc');

  const detectedPrograms = [];
  if (hasGssoc) detectedPrograms.push('gssoc');
  if (hasEcsoc) detectedPrograms.push('ecsoc');

  core.info(`Detected programs: ${detectedPrograms.join(', ') || 'none'}`);

  // Fetch available labels in the repo
  let availableLabels = await fetchPaginatedLabels(github, owner, repo);

  // Ensure labels exist if they were detected
  if (hasGssoc && !availableLabels.map(normalize).includes('gssoc:approved')) {
    if (!dryRun) {
      await ensureLabelExists(github, owner, repo, 'gssoc:approved', '0052cc', 'GSSoC approved contribution');
    }
    availableLabels.push('gssoc:approved');
  }

  if (hasEcsoc && !availableLabels.map(normalize).includes('ecsoc26')) {
    if (!dryRun) {
      await ensureLabelExists(github, owner, repo, 'ECSoC26', '0284c7', 'ECSoC 2026 pull request');
    }
    availableLabels.push('ECSoC26');
  }

  // Ask automated message if neither was mentioned and the comment hasn't been posted yet
  if (!hasGssoc && !hasEcsoc) {
    if (!hasAutomatedComment) {
      if (!dryRun) {
        const commentBody = `👋 Hello! Are you a part of GSSOC or ECSoC?

Please reply to this PR with either **GSSOC** or **ECSoC** so we can label it correctly.`;
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: pullNumber,
          body: commentBody
        });
        core.info(`Posted automated comment asking for program membership on PR #${pullNumber}`);
      } else {
        core.info(`Dry run: would post automated comment asking for program membership on PR #${pullNumber}`);
      }
    } else {
      core.info(`Automated comment already exists on PR #${pullNumber}`);
    }
  }

  const changedFiles = await fetchPullRequestFiles(github, owner, repo, pullNumber);
  const linkedIssueNumbers = findLinkedIssueNumbers(`${pullRequest.title}\n${pullRequest.body || ''}`);
  const linkedIssueLabels = await fetchIssueLabels(github, owner, repo, linkedIssueNumbers);
  const currentLabels = (pullRequest.labels || []).map((label) =>
    typeof label === 'string' ? label : label.name
  );

  const labelsToAdd = selectLabels({
    prTitle: pullRequest.title,
    prBody: pullRequest.body || '',
    changedFiles,
    linkedIssueLabels,
    currentLabels,
    availableLabels,
    rules,
    detectedPrograms
  });

  // Handle merge conflict label
  const isConflict = pullRequest.mergeable === false || pullRequest.mergeable_state === 'dirty';
  const hasConflictLabel = currentLabels.map(normalize).includes('merge conflicts');

  if (isConflict && !hasConflictLabel) {
    if (!availableLabels.map(normalize).includes('merge conflicts')) {
      if (!dryRun) {
        await ensureLabelExists(github, owner, repo, 'merge conflicts', 'd73a4a', 'PR has merge conflicts');
      }
      availableLabels.push('merge conflicts');
    }
    labelsToAdd.push('merge conflicts');
  }

  const isClean = pullRequest.mergeable === true;
  if (isClean && hasConflictLabel) {
    core.info(`PR is mergeable and has 'merge conflicts' label. Removing the label...`);
    if (!dryRun) {
      try {
        await github.rest.issues.removeLabel({
          owner,
          repo,
          issue_number: pullNumber,
          name: 'merge conflicts'
        });
      } catch (error) {
        core.warning(`Failed to remove 'merge conflicts' label: ${error.message}`);
      }
    }
  }

  core.info(`Changed files: ${changedFiles.join(', ') || 'none'}`);
  core.info(`Linked issues: ${linkedIssueNumbers.join(', ') || 'none'}`);
  core.info(`Linked issue labels: ${linkedIssueLabels.join(', ') || 'none'}`);
  core.info(`Labels selected: ${labelsToAdd.join(', ') || 'none'}`);

  if (labelsToAdd.length === 0 || dryRun) {
    if (dryRun) core.info('Dry run enabled; labels were not applied.');
    return labelsToAdd;
  }

  await github.rest.issues.addLabels({
    owner,
    repo,
    issue_number: pullNumber,
    labels: labelsToAdd
  });

  return labelsToAdd;
}

module.exports = {
  findLinkedIssueNumbers,
  hasProgramSignal,
  loadRules,
  run,
  selectLabels
};
