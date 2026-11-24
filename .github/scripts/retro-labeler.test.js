'use strict';

const fs = require('fs');
const path = require('path');

const DIFFICULTY_LABELS = [
  'level:beginner',
  'level:intermediate',
  'level:advanced',
  'level:critical'
];

const TYPE_LABELS = [
  'type:security',
  'type:performance',
  'type:bug',
  'type:feature',
  'type:refactor',
  'type:testing',
  'type:design',
  'type:devops',
  'type:docs',
  'type:accessibility'
];

const normalizeLabel = value => String(value || '').trim().toLowerCase();

function getLabelNames(labels = []) {
  return labels
    .map(label => typeof label === 'string' ? label : label && label.name)
    .filter(Boolean);
}

function loadLabelRules() {
  const rulesPath = path.join(__dirname, '..', 'pr-labeler-rules.json');

  try {
    return JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function matchesRule(pattern, value) {
  try {
    return new RegExp(pattern, 'i').test(value || '');
  } catch {
    return false;
  }
}

function evaluateRulesForPR({ pr, changedFiles = [], rules = {} }) {
  const currentLabels = new Set(getLabelNames(pr.labels).map(normalizeLabel));
  const suggestedLabels = new Set();

  for (const rule of rules.titleRules || []) {
    if (matchesRule(rule.pattern, pr.title)) {
      for (const label of rule.labels || []) {
        if (label) suggestedLabels.add(label);
      }
    }
  }

  for (const file of changedFiles) {
    for (const rule of rules.pathRules || []) {
      if (matchesRule(rule.pattern, file)) {
        for (const label of rule.labels || []) {
          if (label) suggestedLabels.add(label);
        }
      }
    }
  }

  return [...suggestedLabels].filter(
    label => !currentLabels.has(normalizeLabel(label))
  );
}

function checkRetroChanges(pr, changedFiles = [], rules = {}) {
  const currentLabels = getLabelNames(pr.labels);
  const currentLabelsLower = new Set(currentLabels.map(normalizeLabel));
  const toAdd = new Set();
  const toRemove = new Set();

  const author = normalizeLabel(pr.user && pr.user.login);
  const isDependabot = author.includes('dependabot');

  if (isDependabot) {
    for (const label of currentLabels) {
      const normalized = normalizeLabel(label);

      if (
        normalized === 'gssoc:approved' ||
        DIFFICULTY_LABELS.some(difficulty => normalized === difficulty)
      ) {
        toRemove.add(label);
      }
    }
  } else {
    // Migrate the old "Beginner" label to "level:beginner".
    const oldBeginner = currentLabels.find(
      label => normalizeLabel(label) === 'beginner'
    );

    if (oldBeginner) {
      toRemove.add(oldBeginner);
      if (!currentLabelsLower.has('level:beginner')) {
        toAdd.add('level:beginner');
      }
    }

    if (pr.merged_at) {
      if (!currentLabelsLower.has('gssoc:approved')) {
        toAdd.add('gssoc:approved');
      }

      const hasDifficulty = currentLabels.some(label =>
        DIFFICULTY_LABELS.includes(normalizeLabel(label))
      ) || toAdd.has('level:beginner');

      if (!hasDifficulty) {
        toAdd.add('level:beginner');
      }
    } else if (pr.state === 'closed') {
      const approvedLabel = currentLabels.find(
        label => normalizeLabel(label) === 'gssoc:approved'
      );

      if (approvedLabel) toRemove.add(approvedLabel);
    }

    for (const label of evaluateRulesForPR({ pr, changedFiles, rules })) {
      toAdd.add(label);
    }
  }

  return {
    toAdd: [...toAdd].filter(label => !toRemove.has(label)),
    toRemove: [...toRemove]
  };
}

function deduplicateTypeLabels({
  currentLabels = [],
  changedFiles = [],
  prTitle = '',
  rules = {}
}) {
  const labels = getLabelNames(currentLabels);
  const allowedTypes = new Set(TYPE_LABELS.map(normalizeLabel));
  const contested = labels.filter(label => allowedTypes.has(normalizeLabel(label)));

  if (contested.length <= 1) {
    return { toKeep: contested[0] || null, toRemove: [] };
  }

  const scores = new Map(
    contested.map(label => [normalizeLabel(label), 0])
  );

  for (const file of changedFiles) {
    for (const rule of rules.pathRules || []) {
      if (!matchesRule(rule.pattern, file)) continue;

      for (const label of rule.labels || []) {
        const key = normalizeLabel(label);
        if (scores.has(key)) scores.set(key, scores.get(key) + 1);
      }
    }
  }

  for (const rule of rules.titleRules || []) {
    if (!matchesRule(rule.pattern, prTitle)) continue;

    for (const label of rule.labels || []) {
      const key = normalizeLabel(label);
      if (scores.has(key)) scores.set(key, scores.get(key) + 3);
    }
  }

  const priority = (rules.typeLabelPriority || TYPE_LABELS).map(normalizeLabel);
  const winner = [...scores.keys()].sort((a, b) => {
    const scoreDifference = scores.get(b) - scores.get(a);
    if (scoreDifference !== 0) return scoreDifference;

    const aPriority = priority.indexOf(a);
    const bPriority = priority.indexOf(b);
    return (aPriority === -1 ? Infinity : aPriority) -
      (bPriority === -1 ? Infinity : bPriority);
  })[0];

  const toKeep = contested.find(label => normalizeLabel(label) === winner);
  const toRemove = contested.filter(label => normalizeLabel(label) !== winner);

  return { toKeep, toRemove };
}

function isRateLimitError(error) {
  if (!error) return false;
  if (error.status === 429) return true;

  if (error.status === 403) {
    const message = normalizeLabel(error.message);
    const responseMessage = normalizeLabel(
      error.response && error.response.data && error.response.data.message
    );

    return [message, responseMessage].some(text =>
      text.includes('rate limit') ||
      text.includes('secondary rate limit') ||
      text.includes('exceeded')
    );
  }

  return false;
}

async function run({
  github,
  context,
  core,
  dryRun = false,
  prState = 'closed',
  sinceHours = 0
}) {
  const { owner, repo } = context.repo;

  core.info(
    `Starting retrospective PR labeler (dryRun=${dryRun}, state=${prState}, sinceHours=${sinceHours}).`
  );

  let repoLabels;

  try {
    repoLabels = await github.paginate(
      github.rest.issues.listLabelsForRepo,
      { owner, repo, per_page: 100 }
    );
  } catch (error) {
    if (isRateLimitError(error)) {
      core.warning(`Rate limit while listing labels: ${error.message}`);
      return 0;
    }
    throw error;
  }

  const availableLabels = new Set(
    repoLabels.map(label => normalizeLabel(label.name))
  );

  async function ensureLabelExists(name, color, description) {
    const key = normalizeLabel(name);
    if (availableLabels.has(key)) return;

    if (dryRun) {
      core.info(`[Dry run] Would create label "${name}".`);
      return;
    }

    try {
      await github.rest.issues.createLabel({
        owner,
        repo,
        name,
        color,
        description
      });
      availableLabels.add(key);
    } catch (error) {
      // GitHub returns 422 if the label already exists.
      if (error.status !== 422) throw error;
      availableLabels.add(key);
    }
  }

  try {
    await ensureLabelExists(
      'gssoc:approved',
      '0052cc',
      'GSSoC approved contribution'
    );
    await ensureLabelExists(
      'level:beginner',
      '0e8a16',
      'Beginner level task or pull request'
    );
  } catch (error) {
    if (isRateLimitError(error)) {
      core.warning(`Rate limit while preparing labels: ${error.message}`);
      return 0;
    }
    throw error;
  }

  const cutoffTime = sinceHours > 0
    ? new Date(Date.now() - sinceHours * 60 * 60 * 1000)
    : null;

  let pullRequests = [];

  try {
    if (cutoffTime) {
      let page = 1;
      let shouldStop = false;

      while (!shouldStop) {
        const response = await github.rest.pulls.list({
          owner,
          repo,
          state: prState,
          sort: 'updated',
          direction: 'desc',
          per_page: 100,
          page
        });

        const pageData = response.data || [];
        if (pageData.length === 0) break;

        for (const pr of pageData) {
          const updatedAt = new Date(pr.updated_at || pr.created_at);

          if (updatedAt < cutoffTime) {
            shouldStop = true;
            break;
          }

          pullRequests.push(pr);
        }

        if (pageData.length < 100) break;
        page += 1;
      }
    } else {
      pullRequests = await github.paginate(
        github.rest.pulls.list,
        { owner, repo, state: prState, per_page: 100 }
      );
    }
  } catch (error) {
    if (isRateLimitError(error)) {
      core.warning(`Rate limit while fetching pull requests: ${error.message}`);
      return 0;
    }
    throw error;
  }

  const rules = loadLabelRules();
  let updatedCount = 0;

  for (const pr of pullRequests) {
    try {
      let changedFiles = [];

      try {
        const files = await github.paginate(
          github.rest.pulls.listFiles,
          {
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100
          }
        );

        changedFiles = files.map(file => file.filename);
      } catch (error) {
        if (isRateLimitError(error)) {
          core.warning(
            `Rate limit while fetching files for PR #${pr.number}: ${error.message}`
          );
          break;
        }

        core.warning(
          `Could not fetch files for PR #${pr.number}: ${error.message}`
        );
      }

      const { toAdd, toRemove } = checkRetroChanges(
        pr,
        changedFiles,
        rules
      );

      const projectedLabels = [
        ...new Set([...getLabelNames(pr.labels), ...toAdd])
      ].filter(label => !toRemove.includes(label));

      const deduplication = deduplicateTypeLabels({
        currentLabels: projectedLabels,
        changedFiles,
        prTitle: pr.title,
        rules
      });

      for (const label of deduplication.toRemove) {
        if (!toRemove.includes(label)) toRemove.push(label);

        const addIndex = toAdd.indexOf(label);
        if (addIndex !== -1) toAdd.splice(addIndex, 1);
      }

      if (toAdd.length === 0 && toRemove.length === 0) continue;

      updatedCount += 1;

      const actions = [];
      if (toAdd.length) actions.push(`add: ${toAdd.join(', ')}`);
      if (toRemove.length) actions.push(`remove: ${toRemove.join(', ')}`);

      if (dryRun) {
        core.info(
          `[Dry run] PR #${pr.number} (${pr.title}): would ${actions.join(' and ')}`
        );
        continue;
      }

      for (const label of toRemove) {
        try {
          await github.rest.issues.removeLabel({
            owner,
            repo,
            issue_number: pr.number,
            name: label
          });
        } catch (error) {
          if (isRateLimitError(error)) throw error;
          core.warning(
            `Could not remove "${label}" from PR #${pr.number}: ${error.message}`
          );
        }
      }

      if (toAdd.length) {
        try {
          await github.rest.issues.addLabels({
            owner,
            repo,
            issue_number: pr.number,
            labels: toAdd
          });
        } catch (error) {
          if (isRateLimitError(error)) throw error;
          core.warning(
            `Could not add labels to PR #${pr.number}: ${error.message}`
          );
        }
      }
    } catch (error) {
      if (isRateLimitError(error)) {
        core.warning(
          `Rate limit while processing PR #${pr.number}; stopping safely.`
        );
        break;
      }

      core.error(`Error processing PR #${pr.number}: ${error.message}`);
    }
  }

  core.info(
    `Finished. Updated or planned updates: ${updatedCount}/${pullRequests.length}.`
  );

  return updatedCount;
}

module.exports = {
  checkRetroChanges,
  deduplicateTypeLabels,
  evaluateRulesForPR,
  isRateLimitError,
  loadLabelRules,
  run
};

