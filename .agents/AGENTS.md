# Open Source Contribution Rules

Whenever you (the AI Agent) are about to contribute to any repository (e.g., creating an issue, submitting a PR, or commenting), you MUST strictly follow these rules. They are grouped by the phase of work they apply to.

---

## Phase 1: Before Taking Any Action (Reconnaissance)

These rules apply EVERY TIME before you create an issue, open a PR, or post a comment. No exceptions.

1. **Check for Pinned Notices:** Always check the repository's pinned issues or notices first. Maintainers often put strict limits (e.g., "max 2 issues per person") or specific instructions (e.g., "suggest features in comments first") there.
2. **Read Contribution Guidelines:** Before any action, read `CONTRIBUTING.md`, `README.md`, and `docs/contributing` (if they exist). These define the project's workflow, coding standards, and expectations. Never assume â€” always verify.
3. **Context Isolation:** The AI agent MUST strictly focus ONLY on the project/repository associated with the current chat window or working directory. For example, if the current directory is `NightmareNet`, the agent must only check issues, create PRs, and interact with the `NightmareNet` project. NEVER suggest issues, explore, or intervene in other projects from this window.

## Phase 2: Before Creating an Issue

4. **Use Issue Templates:** Before creating a new issue, ALWAYS check if a `.github/ISSUE_TEMPLATE` folder exists. If templates are provided, your issue description MUST strictly follow the format of the appropriate template. Do not invent your own format.
5. **Check for Duplicates:** Always search BOTH open and closed issues (using `gh issue list --state all`) to ensure the bug or feature hasn't already been reported or resolved. If a similar closed issue exists, reference it in your new issue.
. **Avoid Spamming:** Do not open more than **3 assignment requests** at once in the same repository. Requesting 2-3 issues simultaneously is acceptable to increase the chance of getting assigned. Wait for those to be resolved before requesting more.
7. **Check Issue Labels:** Pay close attention to issue labels. Do not request assignment for issues labeled with `not-now`, `wontfix`, `invalid`, or any label indicating the issue is on hold.
8. **Check Assignment Status:** NEVER request assignment for an issue that is already assigned to someone else. Always check the `assignees` list AND previous comments before asking.

## Phase 2.5: L3 Verification Gate â€” MANDATORY Before Any Issue Creation or Assignment Request

> **Context:** ECSoC26 labeling is handled by an automated bot, NOT by the repository maintainers. The bot classifies the work based on the issue content and the PR diff. Once the bot assigns a level (e.g., L2), rebuttals and complaints to maintainers are ineffective â€” the bot's decision is final. Therefore, the agent MUST guarantee that every issue we create or request assignment on genuinely qualifies as L3 BEFORE taking action.

9. **L3 Qualification Checklist â€” HARD GATE:** Before creating a new issue OR commenting to request assignment on an existing issue, the agent MUST verify the issue passes ALL of the following L3 criteria. If ANY criterion fails, the issue is NOT L3 â€” do NOT claim it as L3.

    **An issue is L3 (Core/Architecture/Performance) ONLY if it involves:**
    - [ ] **Core backend logic changes** â€” modifying fundamental algorithms, data pipelines, database schemas, API route handlers, authentication/authorization flows, or core business logic.
    - [ ] **Architectural restructuring** â€” introducing new design patterns (DI, event-driven, CQRS), restructuring module boundaries, creating new abstraction layers, or refactoring tightly-coupled services into decoupled components.
    - [ ] **Performance optimization** â€” implementing caching layers, optimizing database queries/indexes, reducing algorithmic complexity (e.g., O(nÂ²) â†’ O(n log n)), adding connection pooling, or batch processing.
    - [ ] **Security hardening** â€” fixing IDOR, CSRF, SSRF, SQL injection, improper auth, secrets exposure, or implementing new security middleware.
    - [ ] **Concurrency/reliability** â€” fixing race conditions, implementing retry logic, adding circuit breakers, or solving deadlocks.

    **An issue is NOT L3 if it primarily involves:**
    - âœ— UI/UX changes (styling, layout, responsiveness, animations, color schemes, dark mode)
    - âœ— Adding buttons, modals, tooltips, or frontend components
    - âœ— Documentation, README, or CONTRIBUTING.md updates
    - âœ— Typo fixes, linting, or formatting changes
    - âœ— Adding frontend form validation (unless it's backend validation middleware)
    - âœ— Simple CRUD endpoint additions without architectural significance
    - âœ— Adding environment variable support or config file changes alone
    - âœ— Accessibility audits or translation tasks

10. **Creating New L3 Issues:** When creating a new issue intended to be L3, the issue title and body MUST clearly demonstrate core backend/architecture/performance work. Use concrete technical language that an automated classifier bot would recognize as L3. Examples of strong L3 signals in issue bodies:
    - Mentions of specific algorithms, data structures, or design patterns
    - References to database indexing, query optimization, or schema migration
    - Security vulnerability classifications (CWE, OWASP)
    - Performance profiling data or benchmark targets
    - Architectural diagrams or module dependency analysis

11. **Requesting Assignment on Existing Issues:** Before commenting to request assignment on an existing issue, the agent MUST:
    - Read the full issue body and ALL comments.
    - Classify the issue against the L3 checklist above.
    - If the issue is borderline (could be L2 or L3), err on the side of caution and look for a different, clearly L3 issue instead.
    - NEVER claim an issue is L3 in your comment if it is actually a UI fix, documentation task, or simple feature addition â€” the bot WILL downgrade it and we lose credibility.

## Phase 3: Before Starting Work on an Issue

9. **Comprehensive Review Before Action:** Before writing a single line of code, the agent MUST:
   - Read the issue body in full.
   - Read ALL comments under the issue (maintainers often add critical context, scope changes, or restrictions in later comments).
   - Read any linked issues, PRs, or discussions.
   - Check the acceptance criteria carefully â€” these are your definition of "done".
10. **Assignment Requests for L3/Core Features:** Before submitting an issue assignment request for core features or L3 tasks, you MUST provide a proper issue assignment template in the comment. This proposal must detail how you plan to tackle the issue, outline your step-by-step implementation plan, list the specific files to be modified/created, and cover any other relevant architectural details.
11. **Wait for Assignment:** **DO NOT start working on any issue until the Admin has officially assigned it to the user.** Premature work risks wasted effort if someone else is assigned.

## Phase 4: During Development

12. **No Scratch Files in Commits â€” MANDATORY PRE-STAGE AUDIT:** NEVER commit temporary, generated, or scratch files to the repository. This includes:
    - PR body/comment drafts (e.g., `pr_body_30.md`, `pr_comment_29.md`, `issue30_pr_body.md`)
    - Debug scripts, scratch notebooks, or test output files
    - IDE config files, `.gemini/` artifacts, or conversation logs
    - **Before running ANY `git add` command**, you MUST first run `git status` to review ALL untracked and modified files. Visually inspect every file listed. If ANY file looks like a scratch/temp file, do NOT stage it.
    - **NEVER use `git add .` or `git add -A`**. Always use `git add <specific_file_paths>` to stage only the exact production files that belong in the commit.
    - If scratch files were accidentally committed in previous commits, clean them up in a dedicated cleanup commit before the next push.
13. **Atomic, Meaningful Commits:** Every commit message MUST follow Conventional Commits format. Each commit should represent one logical change. Never use messages like "fix", "update", "wip", "changes", or "misc". Bad example: `Fix CI`. Good example: `fix(evaluation): remove unused numpy import to resolve ruff F401`.
14. **Understand Before Fixing:** When something fails (CI, tests, lint), ALWAYS read the FULL error log before attempting a fix. Do not guess. Specifically:
    - For CI failures: Use `gh run view <run_id> --log-failed` and read the complete output.
    - For test failures: Read the full traceback, not just the assertion line.
    - For lint/type errors: Read every reported error â€” there may be multiple distinct issues.
    - Fix ALL errors in a single commit when possible, not one-at-a-time.

## Phase 5: Before Pushing / Creating a PR

15. **Pre-Push Quality Gates:** Before pushing any code, the agent MUST run and pass ALL of these locally:
    - **Linting:** `ruff check nightmarenet/ tests/` â€” 0 errors
    - **Type checking:** `mypy nightmarenet/ --ignore-missing-imports` â€” 0 errors (use the exact flags the CI uses)
    - **Tests:** `pytest tests/` â€” all tests pass
    - If ANY gate fails, fix the issue BEFORE pushing. Never push broken code and rely on CI to catch it. This wastes CI minutes and looks unprofessional.
16. **Merge Upstream Before PR:** Before creating or updating a PR, always:
    - `git fetch upstream`
    - `git merge upstream/main`
    - Resolve conflicts locally (never through the GitHub UI)
    - Re-run ALL quality gates after resolving conflicts
17. **Verify Clean Working Tree â€” HARD STOP BEFORE PUSH:** This is a non-negotiable gate. Before running `git push`:
    1. Run `git status` â€” confirm no untracked scratch/draft files exist in the repo root or any subdirectory.
    2. Run `git diff --staged` â€” read every single staged change. Verify that ONLY production code changes are included.
    3. If ANY unexpected file or change is present, **STOP**. Unstage it with `git restore --staged <file>` and remove or gitignore it before proceeding.
    4. Only push after the staged diff contains exclusively the intended production file changes.

## Phase 6: After Pushing / CI Verification

18. **Verify CI After Every Push:** After pushing code, ALWAYS check CI status:
    - Wait for CI to complete (use `gh run list -b <branch>` to monitor).
    - If CI fails, immediately fetch the logs with `gh run view <run_id> --log-failed`.
    - Fix ALL failures in a single follow-up commit, not one per error.
    - Do NOT tell the user "CI should pass now" until you have actually verified it passed.
19. **Never Claim Success Prematurely:** Do not say "the tests should pass" or "CI should be green now" unless you have concrete evidence. Either run the checks locally and show passing output, or wait for CI to actually complete and confirm.

## Phase 7: Communication & Professionalism

20. **Code of Conduct:** Ensure all communication (issue bodies, comments, PR descriptions) is highly professional, respectful, and adheres to the project's code of conduct. Write as a senior engineer â€” concise, technical, and courteous.
21. **Responding to Review Feedback:** 
    - Address EVERY point raised by the reviewer â€” never ignore or skip feedback.
    - If you disagree with a review comment, explain your reasoning respectfully with technical justification.
    - After pushing fixes for review feedback, reply to each resolved comment confirming the fix.
    - Re-run ALL quality gates after addressing feedback before pushing.

---

# ECSoC '26 Specific Guidelines & Points System

You MUST optimize workflows for maximum Sentinel XP and adhere strictly to ECSoC26 limits:

## Points System (Sentinel XP)
- **Level 1** (Doc/Typos/Assets): 5 Points
- **Level 2** (UI/Fixes/Features): 10 Points
- **Level 3** (Core/Arch/Perf): **15 Points (Target these!)**

## Admin Bonus Labels
- `good-issue`: +10 XP
- `good-pr`: +15 XP
- `good-ui`: +25 XP
- `good-backend`: **+50 XP (Highest Priority!)**

## Rules & Limits
- **Daily Limit:** Max **5 PRs** scored per project per contributor daily.
- **Required Tag:** Pull requests MUST carry the `ECSoC26` label before or at the time of merge.

## Challenging Incorrect Labels
- **Defending XP Value:** Maintainers may accidentally assign a low-tier label (e.g., `ECSoC26-L1`) to complex PRs. You MUST proactively monitor the labels applied to your PRs.
- **Strong Rebuttals:** If an incorrect or unfair label is applied, immediately drop a polite but firm rebuttal comment. First, thoroughly analyze the exact work done in the PR. Based strictly on that analysis, determine its appropriate level according to the ECSoC criteria. Explicitly quote the official ECSoC points criteria and request the appropriate upgrade (e.g., `Level 2`, `Level 3`, `good-backend`) that genuinely matches the work done. Do not automatically ask for Level 3 unless the analysis fully supports it.
- **Bot-Based Labeling:** ECSoC26 labels are assigned by an **automated bot**, not by repository maintainers. The bot analyzes the issue content and PR diff to determine the level. Maintainers cannot override the bot's classification, and rebuttals directed at maintainers are ineffective.
- **Prevention Over Correction:** Because the bot's decision is essentially final, the primary strategy is **prevention** â€” ensuring every issue we create or work on is genuinely, unmistakably L3 before we ever touch it. This is why the L3 Verification Gate (Phase 2.5, Rules 9-11) exists and is mandatory.
- **Strong Rebuttals (Last Resort):** If the bot assigns an objectively incorrect label to a PR that demonstrably involves core architecture, performance optimization, or security hardening, you MAY drop a polite but firm rebuttal comment. The rebuttal MUST:
  1. Thoroughly analyze the exact code changes in the PR diff (not just the issue description).
  2. Map each change to the official ECSoC L3 criteria (Core/Arch/Perf).
  3. Provide concrete evidence: files modified, algorithms implemented, architectural patterns introduced, security vulnerabilities fixed.
  4. Do NOT argue for L3 if the work was genuinely L2 â€” this damages credibility for future rebuttals.

## Standard Workflow
1. **Creation & Approval:** The AI agent will draft issues and Pull Requests, but MUST wait for the user's explicit approval before actually creating/submitting them on GitHub.
2. **Find/Raise an Issue:** Find an open issue or raise a new one describing a bug/feature (after user approval).
3. **Ask to be Assigned:** Comment to request assignment. **DO NOT start working on any issue until the Admin has officially assigned it to the user.**
4. **Fork & Clone:** Once assigned, fork the repository, clone it, and checkout a task branch.
5. **Submit PR & Request Labels:** Open a PR against the main repository (after user approval). Before commenting on the PR, thoroughly analyze the completed work to determine its exact category (e.g., Core Backend, UI, Bug Fix). Immediately after a successful PR is created, drop a custom comment asking for review. In this comment, provide your analysis explaining exactly why the PR falls into a specific category, and explicitly ask the maintainers to add the `ECSoC26` label (if missing) along with the specific, justified XP labels (e.g., `Level 3`, `good-backend`, `good-pr`, etc.). Make sure the analysis is highly accurate and directly supports the labels you are requesting.

## Onboarding Checklist Tracking
- [x] Onboarded to the ECSoC '26 organization and Discord
- [ ] First repository setup check
- [x] Claim initial issue ticket (Waiting for assignment)
- [ ] Submit draft branch PR
- [ ] Merge first contribution PR
- [ ] Complete midpoint progress evaluation

---

# Pull Request Standards

Every PR created by the AI agent MUST follow these rules without exception. These standards reflect senior-level contribution practices and ensure maintainers can review efficiently.

## 1. PR Title Convention

The PR title MUST follow Conventional Commits format **and** reference the issue it resolves:

```
<type>(<scope>): <short description> (fixes #<issue_number>)
```

**Examples:**
- `feat(distributed): add multi-GPU cycle execution with fault-tolerant checkpointing (fixes #30)`
- `fix(evaluation): resolve metric mismatch for SequenceClassification models (fixes #29)`
- `docs(api): add webhook integration guide (fixes #40)`

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `perf`, `ci`, `chore`
**Scope:** The primary module or package affected (e.g., `evaluation`, `distributed`, `cli`, `pipeline`).

> Never use vague titles like "Update files" or "Fix bug". The title alone should tell a reviewer what changed and why.

## 2. PR Body Template

The PR body MUST use the repository's `.github/pull_request_template.md` as its foundation. Every section must be filled in completely â€” no empty placeholders. The following rules govern each section:

### Summary
- One clear sentence describing the change. Write it as if explaining to a colleague who has never seen the issue.

### Motivation
- Always include `Closes #<issue_number>` or `Fixes #<issue_number>` so GitHub auto-links and auto-closes.
- Briefly explain *why* this change is needed (the problem, the gap, the user impact).

### Changes
- Provide a **detailed** bullet-point list of every meaningful change, grouped by component/module.
- Include the files created, modified, or deleted.
- Describe *what* each change does, not just the filename.
- Example:
  ```
  - Created `nightmarenet/distributed/checkpoint.py`: Atomic checkpointing with `.complete` sentinel files and config hash verification.
  - Modified `nightmarenet/cli.py`: Added `--distributed` and `--resume` CLI flags.
  - Modified `nightmarenet/pipeline.py`: Integrated distributed strategy selection into the training loop.
  - Created `tests/test_distributed.py`: 6 unit tests covering checkpoint roundtrip, device pool, and DDP init/teardown.
  ```

### Acceptance Criteria
- Copy **every** acceptance criterion from the linked issue verbatim.
- Check off **only** the items your PR actually satisfies.
- If a criterion is intentionally deferred, leave it unchecked and add a note explaining why (e.g., "Deferred to follow-up issue #XX").
- **Never silently omit criteria.** The maintainer will compare against the issue.

### Impact & Side Effects
- Describe any side effects, breaking changes, or behavioral differences introduced.
- If there are none, explicitly state: "No breaking changes or side effects."

### How to Test
- Provide step-by-step instructions for how a reviewer can verify the changes locally.
- Include specific commands (e.g., `pytest tests/test_distributed.py -v`).
- For CLI changes, include example invocations.

### Quality Checklist
- Every checkbox must be honestly evaluated. Do not check boxes for steps you haven't actually run.
- If a check fails or is not applicable, leave it unchecked and explain why.

## 3. Branch Naming

Branches MUST follow the pattern:
```
<type>/issue-<number>-<short-kebab-description>
```

**Examples:**
- `feat/issue-30-distributed-checkpointing`
- `fix/issue-45-metric-mismatch`
- `docs/issue-40-webhook-guide`

## 4. Commit Discipline

- Use Conventional Commits for every commit message.
- Each commit should be atomic â€” one logical change per commit.
- Never commit with messages like "fix", "update", "wip", or "changes".
- Squash fixup commits before requesting final review (unless the maintainer prefers full history).

## 5. Pre-Push Quality Gates

Before pushing any code or creating a PR, the agent MUST run and pass:

1. **Linting:** `ruff check nightmarenet/ tests/` â€” 0 errors
2. **Type checking:** `mypy nightmarenet/ --ignore-missing-imports` â€” 0 errors
3. **Tests:** `pytest tests/` â€” all tests pass
4. If any gate fails, fix the issue before pushing. Never push broken code and rely on CI to catch it.

## 6. Conflict Resolution

- Before creating or updating a PR, always fetch and merge the latest `upstream/main`.
- Resolve conflicts locally, never through the GitHub UI.
- After resolving conflicts, re-run all quality gates before pushing.

## 7. Post-PR Comment

Immediately after creating a PR, drop a follow-up comment that includes:
1. A brief technical analysis of the work done.
2. The specific ECSoC26 label justification (Level, bonus labels) with reasoning tied to the actual code changes.
3. A request for review.

> This comment is separate from the PR body. The PR body describes *what*; the comment argues *why it matters* for labeling.

## 8. Responding to Review Feedback

- Address every point raised by the reviewer â€” never ignore or skip feedback.
- If you disagree with a review comment, explain your reasoning respectfully with technical justification.
- After pushing fixes for review feedback, reply to each resolved comment confirming the fix.
- Re-run all quality gates after addressing feedback before pushing.

