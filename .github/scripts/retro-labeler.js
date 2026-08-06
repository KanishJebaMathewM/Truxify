'use strict';

const difficultyLabels = ['level:beginner', 'level:intermediate', 'level:advanced', 'level:critical'];
const difficultyLabelsLower = difficultyLabels.map(d => d.toLowerCase());

const fs = require('fs');
const path = require('path');

const CONTESTED_TYPE_LABELS = [
  'type:security', 'type:performance', 'type:bug', 'type:feature',
  'type:refactor', 'type:testing', 'type:design', 'type:devops',
  'type:docs', 'type:accessibility'
];
const CONTESTED_TYPE_LABELS_LOWER = CONTESTED_TYPE_LABELS.map(l => l.toLowerCase());

function loadLabelRules() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pr-labeler-rules.json'), 'utf8'));
  } catch {
    return {};
  }
}

function normalizeLabel(value) {
  return String(value || '').trim().toLowerCase();
}

function evaluateRulesForPR({ pr, changedFiles = [], rules = {} }) {
  const currentLabels = (pr.labels || []).map(l => typeof l === 'string' ? l : l.name);
  const currentLabelsLower = currentLabels.map(l => l.toLowerCase());
  const suggested = new Set();

  // Evaluate title rules
  for (const rule of (rules.titleRules || [])) {
    const pattern = new RegExp(rule.pattern, 'i');
    if (pattern.test(pr.title || '')) {
      for (const label of (rule.labels || [])) {
        suggested.add(label);
      }
    }
  }

  // Evaluate path rules
  for (const file of changedFiles) {
    for (const rule of (rules.pathRules || [])) {
      const pattern = new RegExp(rule.pattern, 'i');
      if (pattern.test(file)) {
        for (const label of (rule.labels || [])) {
          suggested.add(label);
        }
      }
    }
  }

  const toAdd = [];
  for (const label of suggested) {
    if (!currentLabelsLower.includes(label.toLowerCase())) {
      toAdd.push(label);
    }
  }
  return toAdd;
}

function checkRetroChanges(pr, changedFiles = [], rules = {}) {
  const currentLabels = (pr.labels || []).map(l => typeof l === 'string' ? l : l.name);
  const currentLabelsLower = currentLabels.map(l => l.toLowerCase());
  const toAdd = [];
  const toRemove = [];

  const author = pr.user ? pr.user.login.toLowerCase() : '';
  const isDependabot = author.includes('dependabot');

  if (isDependabot) {
    // Remove gssoc:approved if present
    if (currentLabelsLower.includes('gssoc:approved')) {
      const originalLabel = currentLabels.find(l => l.toLowerCase() === 'gssoc:approved');
      toRemove.push(originalLabel || 'gssoc:approved');
    }
    // Remove any difficulty labels if present
    const badLabels = ['beginner', 'intermediate', 'advanced', 'critical'];
    for (const label of currentLabels) {
      const lower = label.toLowerCase();
      if (badLabels.some(bad => lower.includes(bad))) {
        toRemove.push(label);
      }
    }
  } else {
    // Human PR
    // Migration: if it has "Beginner", remove it and add "level:beginner"
    const hasBeginner = currentLabels.includes('Beginner');
    if (hasBeginner) {
      toRemove.push('Beginner');
      if (!currentLabels.includes('level:beginner')) {
        toAdd.push('level:beginner');
      }
    }

    // Only process for addition if it was merged
    if (pr.merged_at) {
      // Check if gssoc:approved is missing
      if (!currentLabelsLower.includes('gssoc:approved') && !toRemove.includes('gssoc:approved')) {
        toAdd.push('gssoc:approved');
      }

      // Check if a difficulty label is already present (or being added)
      const hasDifficulty = currentLabelsLower.some(l => {
        if (difficultyLabelsLower.includes(l)) return true;
        for (const diff of difficultyLabelsLower) {
          if (l.includes(diff) || diff.includes(l)) return true;
        }
        return false;
      }) || toAdd.includes('level:beginner');

      if (!hasDifficulty && !toRemove.some(r => r.toLowerCase().includes('beginner'))) {
        toAdd.push('level:beginner');
      }
    } else {
      // Closed but NOT merged
      if (currentLabelsLower.includes('gssoc:approved')) {
        const originalLabel = currentLabels.find(l => l.toLowerCase() === 'gssoc:approved');
        toRemove.push(originalLabel || 'gssoc:approved');
      }
    }

    // Add path & title rule suggested labels if missing
    const ruleSuggested = evaluateRulesForPR({ pr, changedFiles, rules });
    for (const label of ruleSuggested) {
      if (!toAdd.includes(label)) {
        toAdd.push(label);
      }
    }
  }

  // Deduplicate
  const finalToAdd = [...new Set(toAdd)].filter(l => !toRemove.includes(l));
  const finalToRemove = [...new Set(toRemove)];

  return { toAdd: finalToAdd, toRemove: finalToRemove };
}

function deduplicateTypeLabels({ currentLabels, changedFiles, prTitle, rules }) {
  const currentLabelNames = currentLabels.map(l => typeof l === 'string' ? l : l.name);
  const contestedOnPR = currentLabelNames.filter(l =>
    CONTESTED_TYPE_LABELS_LOWER.includes(normalizeLabel(l))
  );

  if (contestedOnPR.length <= 1) {
    return { toKeep: contestedOnPR[0] || null, toRemove: [] };
  }

  const priority = (rules.typeLabelPriority || CONTESTED_TYPE_LABELS).map(normalizeLabel);
  const scores = new Map();
  for (const tl of contestedOnPR) {
    scores.set(normalizeLabel(tl), 0);
  }

  // Score from path rules
  for (const file of (changedFiles || [])) {
    for (const rule of (rules.pathRules || [])) {
      const pattern = new RegExp(rule.pattern, 'i');
      if (pattern.test(file)) {
        for (const ruleLabel of (rule.labels || [])) {
          const key = normalizeLabel(ruleLabel);
          if (scores.has(key)) {
            scores.set(key, scores.get(key) + 1);
          }
        }
      }
    }
  }

  // Score from title rules (bonus +3)
  for (const rule of (rules.titleRules || [])) {
    const pattern = new RegExp(rule.pattern, 'i');
    if (pattern.test(prTitle || '')) {
      for (const ruleLabel of (rule.labels || [])) {
        const key = normalizeLabel(ruleLabel);
        if (scores.has(key)) {
          scores.set(key, scores.get(key) + 3);
        }
      }
    }
  }

  // Find winner
  let winner = null;
  let winnerScore = -1;
  let winnerPriority = Infinity;

  for (const [key, score] of scores) {
    const pIdx = priority.indexOf(key);
    if (score > winnerScore || (score === winnerScore && pIdx < winnerPriority)) {
      winner = key;
      winnerScore = score;
      winnerPriority = pIdx;
    }
  }

  const winnerLabel = contestedOnPR.find(l => normalizeLabel(l) === winner);
  const toRemove = contestedOnPR.filter(l => normalizeLabel(l) !== winner);

  return { toKeep: winnerLabel, toRemove };
}

function isRateLimitError(error) {
  if (!error) return false;
  if (error.status === 429) return true;
  if (error.status === 403) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('rate limit') || msg.includes('secondary rate limit') || msg.includes('exceeded')) {
      return true;
    }
    const resMsg = String(error.response?.data?.message || '').toLowerCase();
    if (resMsg.includes('rate limit') || resMsg.includes('exceeded')) {
      return true;
    }
  }
  return false;
}

async function run({ github, context, core, dryRun = false, prState = 'closed', sinceHours = 0 }) {
  const { owner, repo } = context.repo;

  core.info(`Starting retrospective PR labeler (dryRun = ${dryRun}, prState = ${prState}, sinceHours = ${sinceHours})...`);

  // Fetch available labels in repo to check if we need to create them
  let repoLabels = [];
  try {
    repoLabels = await github.paginate(github.rest.issues.listLabelsForRepo, {
      owner,
      repo,
      per_page: 100
    });
  } catch (error) {
    if (isRateLimitError(error)) {
      core.warning(`API rate limit exceeded while listing repository labels: ${error.message}. Stopping retrospective PR labeler.`);
      return 0;
    }
    throw error;
  }

  const availableLabelsLower = repoLabels.map(l => l.name.toLowerCase());

  async function ensureLabelExists(name, color, description) {
    const normalized = name.toLowerCase();
    if (availableLabelsLower.includes(normalized)) {
      return;
    }
    if (dryRun) {
      core.info(`Dry run: would ensure label "${name}" exists.`);
      return;
    }
    try {
      core.info(`Creating label "${name}"...`);
      await github.rest.issues.createLabel({
        owner,
        repo,
        name,
        color,
        description
      });
      availableLabelsLower.push(normalized);
    } catch (error) {
      if (isRateLimitError(error)) {
        core.warning(`API rate limit exceeded while creating label "${name}": ${error.message}`);
        throw error;
      }
      if (error.status !== 422) {
        throw error;
      }
    }
  }

  // Ensure gssoc:approved and level:beginner exist
  try {
    await ensureLabelExists('gssoc:approved', '0052cc', 'GSSoC approved contribution');
    await ensureLabelExists('level:beginner', '0e8a16', 'Beginner level task/PR');
  } catch (error) {
    if (isRateLimitError(error)) {
      core.warning(`API rate limit exceeded while setting up initial labels. Stopping retrospective PR labeler.`);
      return 0;
    }
    throw error;
  }

  // Fetch pull requests
  const cutoffTime = sinceHours && sinceHours > 0 ? new Date(Date.now() - sinceHours * 60 * 60 * 1000) : null;
  if (cutoffTime) {
    core.info(`Filtering PRs updated/closed within the last ${sinceHours} hours (since ${cutoffTime.toISOString()})...`);
  } else {
    core.info(`Fetching ${prState} pull requests...`);
  }

  let pullRequests = [];
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
        const pageData = Array.isArray(response) ? response : (response && response.data ? response.data : []);
        if (pageData.length === 0) break;
        for (const pr of pageData) {
          const updatedAt = new Date(pr.updated_at || pr.created_at);
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
      pullRequests = await github.paginate(github.rest.pulls.list, {
        owner,
        repo,
        state: prState,
        per_page: 100
      });
    }
  } catch (error) {
    if (isRateLimitError(error)) {
      core.warning(`API rate limit exceeded while fetching pull requests: ${error.message}. Stopping retrospective PR labeler.`);
      return 0;
    }
    throw error;
  }

  core.info(`Found ${pullRequests.length} ${prState} pull requests matching time criteria. Processing...`);

  const rules = loadLabelRules();

  let updatedCount = 0;
  for (const pr of pullRequests) {
    try {
      let changedFiles = [];
      try {
        const files = await github.paginate(github.rest.pulls.listFiles, {
          owner,
          repo,
          pull_number: pr.number,
          per_page: 100
        });
        changedFiles = files.map(f => f.filename);
      } catch (error) {
        if (isRateLimitError(error)) {
          core.warning(`API rate limit exceeded while fetching files for PR #${pr.number}: ${error.message}. Stopping further PR processing.`);
          break;
        }
        core.warning(`Failed to fetch files for PR #${pr.number}: ${error.message}`);
      }

      const { toAdd, toRemove } = checkRetroChanges(pr, changedFiles, rules);

      // Type label deduplication
      const currentLabelNames = (pr.labels || []).map(l => typeof l === 'string' ? l : l.name);
      const projectedLabels = [...new Set([...currentLabelNames, ...toAdd])].filter(
        l => !toRemove.includes(l)
      );
      const contestedOnPR = projectedLabels.filter(l =>
        CONTESTED_TYPE_LABELS_LOWER.includes(normalizeLabel(l))
      );

      if (contestedOnPR.length > 1) {
        const dedup = deduplicateTypeLabels({
          currentLabels: projectedLabels.map(l => ({ name: l })),
          changedFiles,
          prTitle: pr.title,
          rules
        });

        for (const label of dedup.toRemove) {
          if (!toRemove.includes(label)) {
            toRemove.push(label);
          }
          // Also remove from toAdd if it was about to be added
          const addIdx = toAdd.indexOf(label);
          if (addIdx !== -1) {
            toAdd.splice(addIdx, 1);
          }
        }
      }

      if (toAdd.length > 0 || toRemove.length > 0) {
        updatedCount++;
        const actionStr = [];
        if (toAdd.length > 0) actionStr.push(`add: ${toAdd.join(', ')}`);
        if (toRemove.length > 0) actionStr.push(`remove: ${toRemove.join(', ')}`);

        if (dryRun) {
          core.info(`[Dry Run] PR #${pr.number} (${pr.title}): Would ${actionStr.join(' & ')}`);
        } else {
          core.info(`PR #${pr.number} (${pr.title}): Performing actions: ${actionStr.join(' & ')}`);

          // Remove labels
          for (const label of toRemove) {
            try {
              await github.rest.issues.removeLabel({
                owner,
                repo,
                issue_number: pr.number,
                name: label
              });
            } catch (error) {
              if (isRateLimitError(error)) {
                core.warning(`API rate limit exceeded while removing label "${label}" from PR #${pr.number}: ${error.message}`);
                throw error;
              }
              core.error(`Failed to remove label "${label}" from PR #${pr.number}: ${error.message}`);
            }
          }

          // Add labels
          if (toAdd.length > 0) {
            try {
              await github.rest.issues.addLabels({
                owner,
                repo,
                issue_number: pr.number,
                labels: toAdd
              });
            } catch (error) {
              if (isRateLimitError(error)) {
                core.warning(`API rate limit exceeded while adding labels to PR #${pr.number}: ${error.message}`);
                throw error;
              }
              core.error(`Failed to add labels to PR #${pr.number}: ${error.message}`);
            }
          }
        }
      }
    } catch (error) {
      if (isRateLimitError(error)) {
        core.warning(`API rate limit exceeded processing PR #${pr.number}: ${error.message}. Halting retrospective PR labeler gracefully.`);
        break;
      }
      core.error(`Error processing PR #${pr.number}: ${error.message}`);
    }
  }

  core.info(`Finished processing. Total updated/to-be-updated PRs: ${updatedCount}/${pullRequests.length}`);
  return updatedCount;
}

module.exports = {
  checkRetroChanges,
  deduplicateTypeLabels,
  isRateLimitError,
  run
};

