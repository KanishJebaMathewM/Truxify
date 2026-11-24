
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_RULES_PATH = path.join(
  __dirname,
  '..',
  'pr-labeler-rules.json'
);

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function loadRules(rulesPath = DEFAULT_RULES_PATH) {
  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    throw new Error('Invalid PR labeler rules file.');
  }

  return rules;
}

function matchesPattern(value, pattern) {
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch (error) {
    throw new Error(`Invalid regular expression "${pattern}": ${error.message}`);
  }
}

function hasProgramSignal({ title = '', body = '', rules = loadRules() }) {
  const text = `${title}\n${body}`.toLowerCase();

  return (rules.programSignals || []).some(signal =>
    text.includes(normalize(signal))
  );
}

function findLinkedIssueNumbers(text = '') {
  const numbers = new Set();

  const regex =
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+)\b/gi;

  let match;

  while ((match = regex.exec(text)) !== null) {
    numbers.add(Number(match[1]));
  }

  return [...numbers];
}

function addLabels(target, labels = []) {
  for (const label of labels) {
    if (label) target.add(label);
  }
}

function labelsMatchingRules(value, rules = []) {
  const labels = new Set();

  for (const rule of rules) {
    if (matchesPattern(value, rule.pattern)) {
      addLabels(labels, rule.labels);
    }
  }

  return labels;
}

function pickDominantTypeLabel({
  candidateLabels,
  changedFiles,
  prTitle,
  rules
}) {
  const priority = (rules.typeLabelPriority || []).map(normalize);

  if (!priority.length) return candidateLabels;

  const prioritySet = new Set(priority);

  const typeLabels = candidateLabels.filter(label =>
    prioritySet.has(normalize(label))
  );

  const otherLabels = candidateLabels.filter(label =>
    !prioritySet.has(normalize(label))
  );

  if (typeLabels.length <= 1) return candidateLabels;

  const scores = new Map();

  for (const label of typeLabels) {
    scores.set(normalize(label), 0);
  }

  for (const file of changedFiles) {
    for (const rule of rules.pathRules || []) {
      if (matchesPattern(file, rule.pattern)) {
        for (const label of rule.labels || []) {
          const key = normalize(label);

          if (scores.has(key)) {
            scores.set(key, scores.get(key) + 1);
          }
        }
      }
    }
  }

  for (const rule of rules.titleRules || []) {
    if (matchesPattern(prTitle, rule.pattern)) {
      for (const label of rule.labels || []) {
        const key = normalize(label);

        if (scores.has(key)) {
          scores.set(key, scores.get(key) + 3);
        }
      }
    }
  }

  let winner = null;
  let highestScore = -1;
  let highestPriority = Infinity;

  for (const [key, score] of scores) {
    const index = priority.indexOf(key);

    if (
      score > highestScore ||
      (score === highestScore && index < highestPriority)
    ) {
      winner = key;
      highestScore = score;
      highestPriority = index;
    }
  }

  const winnerLabel = typeLabels.find(
    label => normalize(label) === winner
  );

  return [...otherLabels, winnerLabel].sort((a, b) =>
    a.localeCompare(b)
  );
}

function selectLabels({
  prTitle = '',
  prBody = '',
  changedFiles = [],
  linkedIssueLabels = [],
  linkedIssueText = '',
  currentLabels = [],
  availableLabels = [],
  rules = loadRules()
}) {
  const selected = new Set();

  const current = new Set(currentLabels.map(normalize));
  const available = new Set(availableLabels.map(normalize));

  const inherited = new Set(
    (rules.inheritLabels || []).map(normalize)
  );

  for (const label of linkedIssueLabels) {
    if (inherited.has(normalize(label))) {
      selected.add(label);
    }
  }

  const programText = `${prTitle}\n${prBody}\n${linkedIssueText}`;

  if (
    (rules.programLabels || []).length &&
    hasProgramSignal({
      title: programText,
      rules
    })
  ) {
    addLabels(selected, rules.programLabels);
  }

  addLabels(
    selected,
    labelsMatchingRules(prTitle, rules.titleRules)
  );

  for (const file of changedFiles) {
    addLabels(
      selected,
      labelsMatchingRules(file, rules.pathRules)
    );
  }

  let result = [...selected]
    .filter(label => available.has(normalize(label)))
    .filter(label => !current.has(normalize(label)))
    .sort((a, b) => a.localeCompare(b));

  if (rules.singleTypeLabel) {
    const prioritySet = new Set(
      (rules.typeLabelPriority || []).map(normalize)
    );

    const existingTypeLabels = currentLabels.filter(label =>
      prioritySet.has(normalize(label))
    );

    if (existingTypeLabels.length) {
      result = result.filter(
        label => !prioritySet.has(normalize(label))
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

  return [...new Set(result)];
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

  return labels.map(label => label.name);
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

  return files.map(file => file.filename);
}

async function fetchLinkedIssueDetails(
  github,
  owner,
  repo,
  issueNumbers
) {
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
        const issueLabels = (issue.labels || []).map(label =>
          typeof label === 'string' ? label : label.name
        );

        addLabels(labels, issueLabels);

        issueTexts.push(
          `${issue.title || ''}\n${issue.body || ''}\n${issueLabels.join(' ')}`
        );
      }
    } catch (error) {
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

async function ensureLabelExists(
  github,
  owner,
  repo,
  name,
  color,
  description
) {
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
    if (
      context.payload.issue &&
      context.payload.issue.pull_request
    ) {
      const response = await github.rest.pulls.get({
        owner,
        repo,
        pull_number: context.payload.issue.number
      });

      pullRequest = response.data;
    } else {
      core.info('No pull request found. Skipping labeler.');
      return [];
    }
  } else {
    const response = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullRequest.number
    });

    pullRequest = response.data;
  }

  const pullNumber = pullRequest.number;
  const rules = loadRules(rulesPath);

  const linkedIssueNumbers = findLinkedIssueNumbers(
    `${pullRequest.title}\n${pullRequest.body || ''}`
  );

  const linkedIssueDetails = await fetchLinkedIssueDetails(
    github,
    owner,
    repo,
    linkedIssueNumbers
  );

  let availableLabels = await fetchPaginatedLabels(
    github,
    owner,
    repo
  );

  const ruleLabels = new Set();

  (rules.programLabels || []).forEach(label =>
    ruleLabels.add(label)
  );

  (rules.titleRules || []).forEach(rule =>
    addLabels(ruleLabels, rule.labels)
  );

  (rules.pathRules || []).forEach(rule =>
    addLabels(ruleLabels, rule.labels)
  );

  for (const label of ruleLabels) {
    if (!availableLabels.some(
      existing => normalize(existing) === normalize(label)
    )) {
      availableLabels.push(label);
    }
  }

  const changedFiles = await fetchPullRequestFiles(
    github,
    owner,
    repo,
    pullNumber
  );

  const currentLabels = (pullRequest.labels || []).map(label =>
    typeof label === 'string' ? label : label.name
  );

  const labelsToAdd = selectLabels({
    prTitle: pullRequest.title,
    prBody: pullRequest.body || '',
    changedFiles,
    linkedIssueLabels: linkedIssueDetails.labels,
    linkedIssueText: linkedIssueDetails.text,
    currentLabels,
    availableLabels,
    rules
  });

  const isConflict =
    pullRequest.mergeable === false ||
    pullRequest.mergeable_state === 'dirty';

  const isClean = pullRequest.mergeable === true;

  const hasConflictLabel = currentLabels.some(
    label => normalize(label) === 'merge conflicts'
  );

  const hasReadyLabel = currentLabels.some(
    label => normalize(label) === 'merge ready'
  );

  if (isConflict) {
    if (!hasConflictLabel) {
      if (!availableLabels.some(
        label => normalize(label) === 'merge conflicts'
      )) {
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
      }

      labelsToAdd.push('merge conflicts');

      if (!dryRun) {
        try {
          const author = pullRequest.user
            ? pullRequest.user.login
            : 'author';

          await github.rest.issues.createComment({
            owner,
            repo,
            issue_number: pullNumber,
            body: `@${author}, please resolve the merge conflicts.`
          });
        } catch (error) {
          core.warning(
            `Failed to post conflict comment: ${error.message}`
          );
        }
      }
    }

    if (hasReadyLabel && !dryRun) {
      try {
        await github.rest.issues.removeLabel({
          owner,
          repo,
          issue_number: pullNumber,
          name: 'merge ready'
        });
      } catch (error) {
        core.warning(
          `Failed to remove merge ready label: ${error.message}`
        );
      }
    }
  }

  if (isClean) {
    if (!hasReadyLabel) {
      if (!availableLabels.some(
        label => normalize(label) === 'merge ready'
      )) {
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
      }

      labelsToAdd.push('merge ready');
    }

    if (hasConflictLabel && !dryRun) {
      try {
        await github.rest.issues.removeLabel({
          owner,
          repo,
          issue_number: pullNumber,
          name: 'merge conflicts'
        });
      } catch (error) {
        core.warning(
          `Failed to remove merge conflicts label: ${error.message}`
        );
      }
    }
  }

  const finalLabels = [...new Set(
    labelsToAdd.filter(label =>
      !currentLabels.some(
        current => normalize(current) === normalize(label)
      )
    )
  )];

  core.info(`PR number: #${pullNumber}`);
  core.info(`Changed files: ${changedFiles.join(', ') || 'none'}`);
  core.info(`Linked issues: ${linkedIssueNumbers.join(', ') || 'none'}`);
  core.info(`Labels selected: ${finalLabels.join(', ') || 'none'}`);

  if (finalLabels.length === 0 || dryRun) {
    if (dryRun) {
      core.info('Dry run enabled. Labels were not applied.');
    }

    return finalLabels;
  }

  await github.rest.issues.addLabels({
    owner,
    repo,
    issue_number: pullNumber,
    labels: finalLabels
  });

  return finalLabels;
}

module.exports = {
  fetchLinkedIssueDetails,
  fetchIssueLabels,
  findLinkedIssueNumbers,
  hasProgramSignal,
  loadRules,
  pickDominantTypeLabel,
  selectLabels,
  run
};
