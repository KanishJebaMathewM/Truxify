import { execSync } from 'child_process';

const repoDir = process.cwd();

function run(cmd) {
    try {
        console.log(`Running: ${cmd}`);
        execSync(cmd, { cwd: repoDir, stdio: 'inherit' });
    } catch (e) {
        console.log(`Error running command (continuing...): ${e.message}`);
    }
}

const branches = [
  "fix/2043-load-filters",
  "fix/2044-profile-fallback",
  "fix/2045-tracker-leak",
  "feat/2046-profile-cache",
  "test/2047-pricing-tests",
  "feat/2048-request-id",
  "security/2049-pagination",
  "chore/2050-graceful-shutdown",
  "perf/2051-driver-indexes",
  "feat/2052-token-rotation",
  "fix/2053-truck-race-conditions",
  "chore/2054-parallel-ci",
  "feat/2055-support-assignment",
  "refactor/2056-order-routes",
  "fix/2057-eta-calculation",
  "security/2058-device-rate-limit",
  "test/2059-jwt-tests",
  "feat/2060-health-checks"
];

const filesToRemove = [
    "create_10_more_issues.js",
    "create_8_more_issues.js",
    "fix_all.js",
    "fix_all_prs.py",
    "solve_18_issues.js",
    "update_18_issues.js",
    "comment_gssoc.js",
    "fix_18_prs.js",
    "clean_all_prs.js"
];

for (const branch of branches) {
    console.log(`\n--- Cleaning branch ${branch} ---`);
    run(`git checkout ${branch}`);
    
    // Remove files from index if they exist
    for (const file of filesToRemove) {
        run(`git rm --cached --ignore-unmatch ${file}`);
    }
    
    // Amend commit and force push
    run(`git commit --amend --no-edit`);
    run(`git push -f fork ${branch}`);
}

run(`git checkout main`);
