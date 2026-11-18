
'use strict';

const fs = require('fs');
const path = require('path');

const DIFFICULTY_LABELS = [
  'level:beginner',
  'level:intermediate',
  'level:advanced',
  'level:critical'
];

const CONTESTED_TYPE_LABELS = [
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

function normalizeLabel(value) {
  return String(value || '').trim().toLowerCase();
}

function getLabelNames(labels = []) {
  return labels
    .map(label => typeof label === 'string' ? label : label?.name)
    .filter(Boolean);
}

/**
 * Loads PR labeling rules.
 */
function loadLabelRules() {
  const rulesPath = path.join(
    __dirname,
    '..',
    'pr-labeler-rules.json'
  );

  try {
    const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

    return {
      ...rules,
      titleRules: Array.isArray(rules.titleRules) ? rules.titleRules : [],
      pathRules: Array.isArray(rules.pathRules) ? rules.pathRules : []
    };
  } catch (error) {
    throw new Error(`Failed to load PR label rules: ${error.message}`);
  }
}

/**
 * Safely checks a regular expression.
 */
function matchesPattern(pattern, value) {
  try {
    return new RegExp(pattern, 'i').test(value || '');
  } catch {
    return false;
  }
}

/**
 * Evaluates title and changed-file rules.
 */
function evaluateRulesForPR({
  pr,
  changedFiles = [],
  rules = {}
}) {
  const currentLabels = getLabelNames(pr.labels);
  const currentLabelsLower = new Set(
    currentLabels.map(normalizeLabel)
  );

  const suggested = new Set();

  for (const rule of rules.titleRules || []) {
    if (matchesPattern(rule.pattern, pr.title)) {
      for (const label of rule.labels || []) {
        if (typeof label === 'string' && label.trim()) {
          suggested.add(label.trim());
        }
      }
    }
  }

  for (const file of changedFiles) {
    for (const rule of rules.pathRules || []) {
      if (matchesPattern(rule.pattern, file)) {
        for (const label of rule.labels || []) {
          if (typeof label === 'string' && label.trim()) {
            suggested.add(label.trim());
          }
        }
      }
    }
  }

  return [...suggested].filter(
    label => !currentLabelsLower.has(normalizeLabel(label))
  );
}

/**
 * Calculates labels to add and remove for a PR.
 */
function checkRetroChanges(pr, changedFiles = [], rules = {}) {
  const currentLabels = getLabelNames(pr.labels);
  const currentLabelsLower = new Set(
    currentLabels.map(normalizeLabel)
  );

  const toAdd = [];
  const toRemove = [];

  const author = normalizeLabel(pr.user?.login);
  const isDependabot = author.includes('dependabot');

  const addLabel = label => {
    if (!currentLabelsLower.has(normalizeLabel(label))) {
      if (!toAdd.some(item => normalizeLabel(item) === normalizeLabel(label))) {
        toAdd.push(label);
      }
    }
  };

  const removeLabel = label => {
    if (!toRemove.some(item => normalizeLabel(item) === normalizeLabel(label))) {
      toRemove.push(label);
    }
  };

  if (isDependabot) {
    // Dependabot PRs should not receive GSSoC or difficulty labels.
    for (const label of currentLabels) {
      const normalized = normalizeLabel(label);

      if (
        normalized === 'gssoc:approved' ||
        DIFFICULTY_LABELS.includes(normalized) ||
        ['beginner', 'intermediate', 'advanced', 'critical'].includes(normalized)
      ) {
        removeLabel(label);
      }
    }

    return { toAdd, toRemove };
  }

  // Migrate the old Beginner label.
  const oldBeginner = currentLabels.find(
    label => normalizeLabel(label) === 'beginner'
  );

  if (oldBeginner) {
    removeLabel(oldBeginner);
    addLabel('level:beginner');
  }

  if (pr.merged_at) {
    // Add GSSoC approval label to merged human PRs.
    addLabel('gssoc:approved');

    const hasDifficulty = currentLabels.some(label =>
      DIFFICULTY_LABELS.includes(normalizeLabel(label))
    ) || toAdd.some(label =>
      DIFFICULTY_LABELS.includes(normalizeLabel(label))
    );

    if (!hasDifficulty) {
      addLabel('level:beginner');
    }
  } else {
    // Remove approval label from PRs that were not merged.
    const approvedLabel = currentLabels.find(
      label => normalizeLabel(label) === 'gssoc:approved'
    );

    if (approvedLabel) {
      removeLabel(approvedLabel);
    }
  }

  // Apply title and path rules to human PRs.
  const suggestedLabels = evaluateRulesForPR({
    pr,
    changedFiles,
    rules
  });

  for (const label of suggestedLabels) {
    addLabel(label);
  }

  // Do not add a label that is also being removed.
  const removedLabels = new Set(toRemove.map(normalizeLabel));

  const finalToAdd = toAdd.filter(
    label => !removedLabels.has(normalizeLabel(label))
  );

  return {
    toAdd: finalToAdd,
    toRemove
  };
}

/**
 * Keeps only the highest-scoring type label.
 */
function deduplicateTypeLabels({
  currentLabels,
  changedFiles = [],
  prTitle = '',
  rules = {}
}) {
  const labels = getLabelNames(currentLabels);

  const contested = labels.filter(label =>
    CONTESTED_TYPE_LABELS.includes(normalizeLabel(label))
  );

  if (contested.length <= 1) {
    return {
      toKeep: contested[0] || null,
      toRemove: []
    };
  }

  const priority = (
    Array.isArray(rules.typeLabelPriority)
      ? rules.typeLabelPriority
      : CONTESTED_TYPE_LABELS
  ).map(normalizeLabel);

  const scores = new Map(
    contested.map(label => [normalizeLabel(label), 0])
  );

  // Score matching path rules.
  for (const file of changedFiles) {
    for (const rule of rules.pathRules || []) {
      if (!matchesPattern(rule.pattern, file)) continue;

      for (const label of rule.labels || []) {
        const key = normalizeLabel(label);

        if (scores.has(key)) {
          scores.set(key, scores.get(key) + 1);
        }
      }
    }
  }

  // Give matching title rules a bonus of 3.
  for (const rule of rules.titleRules || []) {
    if (!matchesPattern(rule.pattern, prTitle)) continue;

    for (const label of rule.labels || []) {
      const key = normalizeLabel(label);

      if (scores.has(key)) {
        scores.set(key, scores.get(key) + 3);
      }
    }
  }

  let winner = null;
  let winnerScore = -1;
  let winnerPriority = Infinity;

  for (const [label, score] of scores) {
    const index = priority.indexOf(label);
    const labelPriority = index === -1 ? Infinity : index;

    if (
      score > winnerScore ||
      (score === winnerScore && labelPriority < winnerPriority)
    ) {
      winner = label;
      winnerScore = score;
      winnerPriority = labelPriority;
    }
  }

  return {
    toKeep: contested.find(
      label => normalizeLabel(label) === winner
    ) || null,

    toRemove: contested.filter(
      label => normalizeLabel(label) !== winner
    )
  };
}

/**
 * Detects GitHub API rate-limit errors.
 */
function isRateLimitError(error) {
  if (!error) return false;

  if (error.status === 429) return true;

  if (error.status === 403) {
    const message = String(
      error.response?.data?.message || error.message || ''
    ).toLowerCase();

    return (
      message.includes('rate limit') ||
      message.includes('secondary rate limit') ||
      message.includes('exceeded')
    );
  }

  return false;
}

/**
 * Main retrospective PR labeler.
 */
async function run({
  github,
  context,
  core,
  dryRun = false,
  prState = 'closed',
  sinceHours = 0
}) {
  const { owner, repo } = context.repo;

  if (!['open', 'closed', 'all'].includes(prState)) {
    throw new Error('prState must be open, closed, or all.');
  }

  if (
    !Number.isFinite(Number(sinceHours)) ||
    Number(sinceHours) < 0
  ) {
    throw new Error('sinceHours must be a non-negative number.');
  }

  sinceHours = Number(sinceHours);

  core.info(
    `Starting retrospective PR labeler (dryRun=${dryRun}, state=${prState}).`
  );

  // Fetch repository labels.
  let repoLabels;

  try {
    repoLabels = await github.paginate(
      github.rest.issues.listLabelsForRepo,
      { owner, repo, per_page: 100 }
    );
  } catch (error) {
    if (isRateLimitError(error)) {
      core.warning('Rate limit reached while fetching repository labels.');
      return 0;
    }
    throw error;
  }

  const availableLabels = new Set(
    repoLabels.map(label => normalizeLabel(label.name))
  );

  /**
   * Creates a missing label when necessary.
   */
  async function ensureLabelExists(name) {
    const normalized = normalizeLabel(name);

    if (availableLabels.has(normalized)) return;

    if (dryRun) {
      core.info(`[Dry Run] Would create label: ${name}`);
      return;
    }

    try {
      await github.rest.issues.createLabel({
        owner,
        repo,
        name,
        color: 'ededed',
        description: 'Automatically managed PR label'
      });

      availableLabels.add(normalized);
    } catch (error) {
      // Another workflow may have created the label already.
      if (error.status === 422) {
        availableLabels.add(normalized);
        return;
      }

      throw error;
    }
  }

  // Ensure the two labels used by the migration exist.
  try {
    await ensureLabelExists('gssoc:approved');
    await ensureLabelExists('level:beginner');
  } catch (error) {
    if (isRateLimitError(error)) {
      core.warning('Rate limit reached while creating initial labels.');
      return 0;
    }
    throw error;
  }

  // Load labeling rules.
  const rules = loadLabelRules();

  // Fetch pull requests.
  let pullRequests = [];

  const cutoffTime = sinceHours > 0
    ? Date.now() - sinceHours * 60 * 60 * 1000
    : null;

  try {
    if (cutoffTime) {
      let page = 1;
      let stop = false;

      while (!stop) {
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
          const updatedAt = new Date(
            pr.updated_at || pr.created_at
          ).getTime();

          if (updatedAt < cutoffTime) {
            stop = true;
            break;
          }

          pullRequests.push(pr);
        }

        if (pageData.length < 100) break;
        page++;
      }
    } else {
      pullRequests = await github.paginate(
        github.rest.pulls.list,
        {
          owner,
          repo,
          state: prState,
          per_page: 100
        }
      );
    }
  } catch (error) {
    if (isRateLimitError(error)) {
      core.warning('Rate limit reached while fetching pull requests.');
      return 0;
    }
    throw error;
  }

  core.info(`Found ${pullRequests.length} pull requests.`);

  let updatedCount = 0;

  for (const pr of pullRequests) {
    try {
      // Fetch changed files.
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
        if (isRateLimitError(error)) throw error;

        core.warning(
          `Could not fetch files for PR #${pr.number}: ${error.message}`
        );
      }

      const { toAdd, toRemove } = checkRetroChanges(
        pr,
        changedFiles,
        rules
      );

      // Determine the labels that will remain after the changes.
      const currentLabels = getLabelNames(pr.labels);

      const projectedLabels = [
        ...currentLabels.filter(label =>
          !toRemove.some(
            removed => normalizeLabel(removed) === normalizeLabel(label)
          )
        ),
        ...toAdd
      ];

      const dedup = deduplicateTypeLabels({
        currentLabels: projectedLabels,
        changedFiles,
        prTitle: pr.title,
        rules
      });

      for (const label of dedup.toRemove) {
        if (!toRemove.some(
          item => normalizeLabel(item) === normalizeLabel(label)
        )) {
          toRemove.push(label);
        }

        const index = toAdd.findIndex(
          item => normalizeLabel(item) === normalizeLabel(label)
        );

        if (index !== -1) {
          toAdd.splice(index, 1);
        }
      }

      if (toAdd.length === 0 && toRemove.length === 0) {
        continue;
      }

      updatedCount++;

      const actions = [];

      if (toAdd.length) actions.push(`add: ${toAdd.join(', ')}`);
      if (toRemove.length) actions.push(`remove: ${toRemove.join(', ')}`);

      if (dryRun) {
        core.info(
          `[Dry Run] PR #${pr.number}: ${actions.join(' | ')}`
        );
        continue;
      }

      // Ensure every label exists before adding it.
      for (const label of toAdd) {
        await ensureLabelExists(label);
      }

      // Remove outdated labels.
      for (const label of toRemove) {
        try {
          await github.rest.issues.removeLabel({
            owner,
            repo,
            issue_number: pr.number,
            name: label
          });
        } catch (error) {
          if (error.status !== 404) throw error;
        }
      }

      // Add new labels.
      if (toAdd.length > 0) {
        await github.rest.issues.addLabels({
          owner,
          repo,
          issue_number: pr.number,
          labels: toAdd
        });
      }

      core.info(
        `Updated PR #${pr.number}: ${actions.join(' | ')}`
      );
    } catch (error) {
      if (isRateLimitError(error)) {
        core.warning(
          `Rate limit reached while processing PR #${pr.number}. Stopping.`
        );
        break;
      }

      core.error(
        `Error processing PR #${pr.number}: ${error.message}`
      );
    }
  }

  core.info(
    `Finished. Total updated or planned PRs: ${updatedCount}/${pullRequests.length}`
  );

  return updatedCount;
}

module.exports = {
  loadLabelRules,
  evaluateRulesForPR,
  checkRetroChanges,
  deduplicateTypeLabels,
  isRateLimitError,
  run
};


