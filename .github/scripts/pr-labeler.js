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

function hasProgramSignal({ title = '', body = '', rules = loadRules() }) {
  const text = `${title}\n${body}`.toLowerCase();
  const signals = rules.programSignals || [];
  return signals.some((signal) => text.includes(normalize(signal)));
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

function pickDominantTypeLabel({ candidateLabels, changedFiles, prTitle, rules }) {
  const priority = (rules.typeLabelPriority || []).map(normalize);
  if (priority.length === 0) return candidateLabels;

  const prioritySet = new Set(priority);
  const typeLabels = candidateLabels.filter((label) =>
    prioritySet.has(normalize(label))
  );
  const nonTypeLabels = candidateLabels.filter(
    (label) => !prioritySet.has(normalize(label))
  );

  if (typeLabels.length <= 1) return candidateLabels;

  const scores = new Map(typeLabels.map((label) => [normalize(label), 0]));

  // Score type labels from changed-file path rules.
  for (const file of changedFiles) {
    for (const rule of rules.pathRules || []) {
      if (new RegExp(rule.pattern, 'i').test(file)) {
        for (const ruleLabel of rule.labels || []) {
          const key = normalize(ruleLabel);
          if (scores.has(key)) {
            scores.set(key, scores.get(key) + 1);
          }
        }
      }
    }
  }

  // Give title-rule matches extra weight.
  for (const rule of rules.titleRules || []) {
    if (new RegExp(rule.pattern, 'i').test(prTitle)) {
      for (const ruleLabel of rule.labels || []) {
        const key = normalize(ruleLabel);
        if (scores.has(key)) {
          scores.set(key, scores.get(key) + 3);
        }
      }
    }
  }

  // Choose the highest-scoring label, breaking ties by priority.
  let winner = null;
  let winnerScore = -1;
  let winnerPriority = Infinity;

  for (const [key, score] of scores) {
    const priorityIndex = priority.indexOf(key);

    if (
      score > winnerScore ||
      (score === winnerScore && priorityIndex < winnerPriority)
    ) {
      winner = key;
      winnerScore = score;
      winnerPriority = priorityIndex;
    }
  }

  const winnerLabel = typeLabels.find((label) => normalize(label) === winner);
  return [...nonTypeLabels, winnerLabel].sort((a, b) =>
    a.localeCompare(b)
  );
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

  // Inherit only labels explicitly configured for inheritance.
  for (const label of linkedIssueLabels) {
    if (inherited.has(normalize(label))) {
      selected.add(label);
    }
  }

  // Apply program labels when program signals are present.
  if (
    rules.programLabels &&
    rules.programLabels.length > 0 &&
    hasProgramSignal({ title: prTitle, body: prBody, rules })
  ) {
    addLabels(selected, rules.programLabels);
  }

  addLabels(selected, labelsMatchingRules(prTitle, rules.titleRules));

  for (const file of changedFiles) {
    addLabels(selected, labelsMatchingRules(file, rules.pathRules));
  }

  let result = [...selected]
    .filter((label) => available.has(normalize(label)))
    .filter((label) => !current.has(normalize(label)))
    .sort((a, b) => a.localeCompare(b));

  if (rules.singleTypeLabel) {
    const prioritySet = new Set(
      (rules.typeLabelPriority || []).map(normalize)
    );

    const currentTypeLabels = currentLabels.filter((label) =>
      prioritySet.has(normalize(label))
    );

    if (currentTypeLabels.length > 0) {
      // Avoid adding a second type label if one is already present.
      result = result.filter(
        (label) => !prioritySet.has(normalize(label))
      );
    } else {
      result = pickDominantTypeLabel({
        candidateLabels: result,
        changedFiles,
        prTitle,
        rules
      });
    }
  }

  return result;
}

async function fetchPaginatedLabels(github, owner, repo) {
  const labels = await github.paginate(
    github.rest.issues.listLabelsForRepo,
    {
      owner,
      repo,
      per_page: 100
    }
  );

  return labels.map((label) => label.name);
}

async function fetchPullRequestFiles(github, owner, repo, pullNumber) {
  const files = await github.paginate(
    github.rest.pulls.listFiles,
    {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100
    }
  );

  return files.map((file) => file.filename);
}

async function fetchLinkedIssueDetails(github, owner, repo, issueNumbers) {
  const labels = new Set();
  const issueTexts = [];

  for (const issueNumber of issueNumbers) {
    try {
      const response = await github.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber
      });

      const issue = response.data;

      if (issue) {
        const issueLabels = (issue.labels || []).map((label) =>
          typeof label === 'string' ? label : label.name
        );

        addLabels(labels, issueLabels);

        issueTexts.push(
          `${issue.title || ''}\n${issue.body || ''}\n${issueLabels.join(' ')}`
        );
      }
    } catch (error) {
      // Missing or cross-repository issues should not block PR labeling.
      continue;
    }
  }

  return {
    labels: [...labels],
    text: issueTexts.join('\n')
  };
}

async function fetchIssueLabels(github, owner, repo, issueNumbers) {
  const details = await fetchLinkedIssueDetails(
    github,
    owner,
    repo,
    issueNumbers
  );
  return details.labels;
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

async function run({
  github,
  context,
  core,
  rulesPath = DEFAULT_RULES_PATH,
  dryRun = false
}) {
  const { owner, repo } = context.repo;
  let pullRequest = context.payload.pull_request;

  if (!pullRequest) {
    if (context.payload.issue && context.payload.issue.pull_request) {
      core.info(
        `Triggered by comment on PR #${context.payload.issue.number}. Fetching PR details...`
      );

      const response = await github.rest.pulls.get({
        owner,
        repo,
        pull_number: context.payload.issue.number
      });

      pullRequest = response.data;
    } else {
      core.info(
        'No pull_request payload found and not an issue comment on a PR; skipping PR labeler.'
      );
      return [];
    }
  } else {
    core.info(
      `Fetching latest PR details for PR #${pullRequest.number}...`
    );

    const response = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullRequest.number
    });

    pullRequest = response.data;
  }

  const pullNumber = pullRequest.number;
  const rules = loadRules(rulesPath);

  // Find linked issues and retrieve their labels.
  const linkedIssueNumbers = findLinkedIssueNumbers(
    `${pullRequest.title}\n${pullRequest.body || ''}`
  );

  const linkedIssueDetails = await fetchLinkedIssueDetails(
    github,
    owner,
    repo,
    linkedIssueNumbers
  );

  const linkedIssueLabels = linkedIssueDetails.labels;

  // Fetch labels currently available in the repository.
  let availableLabels = await fetchPaginatedLabels(
    github,
    owner,
    repo
  );

  // Include configured rule labels even if they are not created yet.
  const ruleLabels = new Set();

  (rules.programLabels || []).forEach((label) =>
    ruleLabels.add(label)
  );

  (rules.titleRules || []).forEach((rule) =>
    (rule.labels || []).forEach((label) => ruleLabels.add(label))
  );

  (rules.pathRules || []).forEach((rule) =>
    (rule.labels || []).forEach((label) => ruleLabels.add(label))
  );

  for (const ruleLabel of ruleLabels) {
    if (
      !availableLabels.some(
        (label) => normalize(label) === normalize(ruleLabel)
      )
    ) {
      availableLabels.push(ruleLabel);
    }
  }

  const changedFiles = await fetchPullRequestFiles(
    github,
    owner,
    repo,
    pullNumber
  );

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
    rules
  });

  // Handle merge-conflict and merge-ready labels.
  const isConflict =
    pullRequest.mergeable === false ||
    pullRequest.mergeable_state === 'dirty';

  const hasConflictLabel = currentLabels
    .map(normalize)
    .includes('merge conflicts');

  const hasReadyLabel = currentLabels
    .map(normalize)
    .includes('merge ready');

  if (isConflict) {
    if (!hasConflictLabel) {
      if (
        !availableLabels.some(
          (label) => normalize(label) === 'merge conflicts'
        )
      ) {
        if (!dryRun) {
          await ensureLabelExists(
            github,
            owner,
            repo,
            'merge conflicts',
            'd73a4a',
            'PR has merge conflicts'
          );
        }

        availableLabels.push('merge conflicts');
      }

      if (
        !labelsToAdd.some(
          (label) => normalize(label) === 'merge conflicts'
        )
      ) {
        labelsToAdd.push('merge conflicts');
      }

      // Notify the author about merge conflicts.
      if (!dryRun) {
        try {
          const author = pullRequest.user
            ? pullRequest.user.login
            : 'author';

          await github.rest.issues.createComment({
            owner,
            repo,
            issue_number: pullNumber,
            body: `@${author}, please resolve the merge conflicts so this PR can be merged.`
          });

          core.info(`Posted merge conflict comment on PR #${pullNumber}`);
        } catch (error) {
          core.warning(
            `Failed to post merge conflict comment: ${error.message}`
          );
        }
      }
    }

    if (hasReadyLabel) {
      core.info(
        "PR has conflicts but has 'merge ready' label. Removing the label..."
      );

      if (!dryRun) {
        try {
          await github.rest.issues.removeLabel({
            owner,
            repo,
            issue_number: pullNumber,
            name: 'merge ready'
          });
        } catch (error) {
          core.warning(
            `Failed to remove 'merge ready' label: ${error.message}`
          );
        }
      }
    }
  }

  const isClean = pullRequest.mergeable === true;

  if (isClean) {
    if (!hasReadyLabel) {
      if (
        !availableLabels.some(
          (label) => normalize(label) === 'merge ready'
        )
      ) {
        if (!dryRun) {
          await ensureLabelExists(
            github,
            owner,
            repo,
            'merge ready',
            '2cbe4e',
            'PR is mergeable and has no conflicts'
          );
        }

        availableLabels.push('merge ready');
      }

      if (
        !labelsToAdd.some(
          (label) => normalize(label) === 'merge ready'
        )
      ) {
        labelsToAdd.push('merge ready');
      }
    }

    if (hasConflictLabel) {
      core.info(
        "PR is mergeable and has 'merge conflicts' label. Removing the label..."
      );

      if (!dryRun) {
        try {
          await github.rest.issues.removeLabel({
            owner,
            repo,
            issue_number: pullNumber,
            name: 'merge conflicts'
          });
        } catch (error) {
          core.warning(
            `Failed to remove 'merge conflicts' label: ${error.message}`
          );
        }
      }
    }
  }

  core.info(`Changed files: ${changedFiles.join(', ') || 'none'}`);
  core.info(`Linked issues: ${linkedIssueNumbers.join(', ') || 'none'}`);
  core.info(`Linked issue labels: ${linkedIssueLabels.join(', ') || 'none'}`);
  core.info(`Labels selected: ${labelsToAdd.join(', ') || 'none'}`);

  if (labelsToAdd.length === 0 || dryRun) {
    if (dryRun) {
      core.info('Dry run enabled; labels were not applied.');
    }
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
  fetchLinkedIssueDetails,
  fetchIssueLabels,
  findLinkedIssueNumbers,
  hasProgramSignal,
  loadRules,
  pickDominantTypeLabel,
  run,
  selectLabels
};
