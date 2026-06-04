# Automatic PR Labeling

Truxify uses `.github/workflows/pr-labeler.yml` to add safe, review-friendly labels to pull requests. The workflow runs on `pull_request_target`, but it only checks trusted repository code, pull request metadata, linked issue labels, and the list of changed file paths. It does not execute code from contributor branches.

## Label Sources

The labeler uses three inputs:

1. Linked issue labels from closing keywords such as `Fixes #320`.
2. Pull request title/body signals mapped to type labels: `type:bug` (fix/bug), `type:feature` (feat/feature), `type:docs` (docs), `type:testing` (test), `type:security` (security/auth), `type:performance` (perf), `type:design` (design/ui), `type:refactor` (refactor), `type:devops` (ci/cd/build), and `type:accessibility` (a11y).
3. Changed file paths such as `apps/customer/`, `apps/driver/`, `backend/api/`, `backend/ml/`, `blockchain/`, `automation/`, docs/markdown files (mapped to `type:docs`), and test files.

The labeler never removes or overwrites labels that maintainers added manually. It also skips any configured label that does not already exist in the repository.

## GSSoC Behavior

The workflow applies `gssoc:approved` when:

- the linked issue already has `gssoc:approved`; or
- the pull request title/body clearly says it is a GSSoC or NSoC contribution.

This keeps GSSoC PRs trackable while still avoiding broad guesses on unrelated maintenance pull requests.

## Updating Rules

Edit `.github/pr-labeler-rules.json` to add path mappings, title patterns, inherited labels, or program signals. Keep rules conservative: prefer adding labels only when the source signal is clear.

## Dry Run

Set the repository variable `PR_LABELER_DRY_RUN` to `true` to log selected labels without applying them. This is useful when testing rule changes before allowing the workflow to label new pull requests automatically.

## Local Test

Run the unit tests before changing the workflow:

```bash
node --test .github/scripts/pr-labeler.test.js
```
