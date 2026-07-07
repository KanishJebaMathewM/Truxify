import { execSync } from 'child_process';

const repoDir = process.cwd();

function run(cmd) {
    console.log(`Running: ${cmd}`);
    execSync(cmd, { cwd: repoDir, stdio: 'inherit' });
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

for (const branch of branches) {
  try {
    console.log(`\n--- Fixing PR branch ${branch} ---`);
    run(`git checkout ${branch}`);
    run(`git cherry-pick 3af6355a513b66cbdca1e7029efbf46470d24ea7`);
    run(`git push -f fork ${branch}`);
  } catch (err) {
    console.error(`Failed on branch ${branch}: ${err.message}`);
  }
}

run(`git checkout main`);
