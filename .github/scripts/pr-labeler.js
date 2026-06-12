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
  rules = loadRules()
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

  // Always apply program labels (like gssoc:approved) to all created PRs
  addLabels(selected, rules.programLabels);

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

async function run({ github, context, core, rulesPath = DEFAULT_RULES_PATH, dryRun = false }) {
  const pullRequest = context.payload.pull_request;
  if (!pullRequest) {
    core.info('No pull_request payload found; skipping PR labeler.');
    return [];
  }

  const { owner, repo } = context.repo;
  const pullNumber = pullRequest.number;
  const rules = loadRules(rulesPath);
  const availableLabels = await fetchPaginatedLabels(github, owner, repo);
  const changedFiles = await fetchPullRequestFiles(github, owner, repo, pullNumber);
  const linkedIssueNumbers = findLinkedIssueNumbers(`${pullRequest.title}\n${pullRequest.body || ''}`);
  const linkedIssueLabels = await fetchIssueLabels(github, owner, repo, linkedIssueNumbers);
  const currentLabels = (pullRequest.labels || []).map((label) => label.name);

  const labelsToAdd = selectLabels({
    prTitle: pullRequest.title,
    prBody: pullRequest.body || '',
    changedFiles,
    linkedIssueLabels,
    currentLabels,
    availableLabels,
    rules
  });

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
