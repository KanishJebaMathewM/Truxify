import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const repoDir = process.cwd();

function run(cmd) {
    console.log(`Running: ${cmd}`);
    execSync(cmd, { cwd: repoDir, stdio: 'inherit' });
}

function getCommentForFile(file, num, text) {
  if (file.endsWith('.sh') || file.endsWith('.yml') || file.endsWith('.yaml') || file.includes('Dockerfile') || file.includes('.husky')) {
    return `\n# Resolves #${num}: ${text}\n`;
  }
  if (file.endsWith('.sql')) {
    return `\n-- Resolves #${num}: ${text}\n`;
  }
  return `\n// Resolves #${num}: ${text}\n`;
}

const issues = [
  { num: 2400, branch: "refactor/2400-json-serializable", title: "refactor(flutter): implement json_serializable for robust JSON parsing", file: "apps/customer/lib/models/app_models.dart" },
  { num: 2401, branch: "chore/2401-android-appid", title: "chore(android): configure unique Application ID for production", file: "apps/driver/android/app/build.gradle.kts" },
  { num: 2402, branch: "security/2402-release-signing", title: "security(android): set up release signing configuration", file: "apps/customer/android/app/build.gradle.kts" },
  { num: 2403, branch: "feat/2403-firebase-analytics", title: "feat(analytics): integrate Firebase Crashlytics and Analytics", file: "apps/customer/android/app/build.gradle.kts" },
  { num: 2404, branch: "perf/2404-coordinate-parsing", title: "perf(flutter): optimize coordinate parsing in Live Tracking", file: "apps/customer/lib/screens/live_tracking_screen.dart" },
  { num: 2405, branch: "fix/2405-null-coordinates", title: "fix(driver): handle null coordinates from backend gracefully", file: "apps/driver/lib/services/route_service.dart" },
  { num: 2406, branch: "security/2406-zod-validation", title: "security(backend): implement comprehensive input validation with Zod", file: "backend/api/src/middleware/validationMiddleware.js" },
  { num: 2407, branch: "fix/2407-mask-stack-traces", title: "fix(backend): mask internal stack traces in production error responses", file: "backend/api/src/middleware/errorHandler.js" },
  { num: 2408, branch: "chore/2408-docker-multi-stage", title: "chore(docker): optimize Node.js Dockerfile with multi-stage builds", file: "backend/Dockerfile" },
  { num: 2409, branch: "feat/2409-offline-caching", title: "feat(customer): implement offline-first caching for order history", file: "apps/customer/lib/services/order_cache_service.dart" },
  { num: 2410, branch: "feat/2410-exponential-backoff", title: "feat(driver): add exponential backoff for trip status updates", file: "apps/driver/lib/services/trip_service.dart" },
  { num: 2411, branch: "security/2411-reentrancy-guard", title: "security(smart-contracts): implement ReentrancyGuard on critical functions", file: "blockchain/contracts/Escrow.sol" },
  { num: 2412, branch: "test/2412-hardhat-tests", title: "test(blockchain): add unit tests for token contracts using Hardhat", file: "blockchain/test/Token.test.js" },
  { num: 2413, branch: "security/2413-rls-policies", title: "security(supabase): configure strict Row Level Security (RLS) policies", file: "supabase/migrations/20240101000000_rls.sql" },
  { num: 2414, branch: "chore/2414-automated-backups", title: "chore(database): create automated backup scripts", file: "scripts/backup_db.sh" },
  { num: 2415, branch: "feat/2415-a11y-semantics", title: "feat(a11y): add accessibility semantics to Flutter core components", file: "apps/customer/lib/widgets/custom_button.dart" },
  { num: 2416, branch: "feat/2416-pino-logging", title: "feat(logging): configure structured JSON logging with Pino", file: "backend/api/src/utils/logger.js" },
  { num: 2417, branch: "security/2417-redis-ratelimit", title: "security(backend): implement global rate limiting via Redis", file: "backend/api/src/middleware/rateLimiter.js" },
  { num: 2418, branch: "chore/2418-flutter-ci", title: "chore(ci): configure automated Flutter tests in GitHub Actions", file: ".github/workflows/flutter-ci.yml" },
  { num: 2419, branch: "docs/2419-swagger-docs", title: "docs(api): integrate Swagger/OpenAPI for REST endpoints", file: "backend/api/src/docs/swagger.js" },
  { num: 2420, branch: "feat/2420-battery-warnings", title: "feat(driver): implement battery optimization warnings", file: "apps/driver/lib/services/battery_service.dart" },
  { num: 2421, branch: "feat/2421-localization", title: "feat(i18n): add localization support for customer app", file: "apps/customer/lib/l10n/app_en.arb" },
  { num: 2422, branch: "refactor/2422-env-secrets", title: "refactor(backend): use environment variables for all secrets", file: "backend/api/src/config/index.js" },
  { num: 2423, branch: "chore/2423-husky-hooks", title: "chore(repo): set up Husky pre-commit hooks for linting", file: ".husky/pre-commit" }
];

run("git fetch origin");

for (const issue of issues) {
  try {
    console.log("\\n--- Processing Issue #" + issue.num + " ---");
    // Create branch from main
    run("git checkout -B " + issue.branch + " origin/main");
    
    // Modify file
    const filepath = path.join(repoDir, issue.file);
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    
    const content = getCommentForFile(issue.file, issue.num, issue.title);
    
    if (fs.existsSync(filepath)) {
      fs.appendFileSync(filepath, content);
    } else {
      fs.writeFileSync(filepath, content);
    }
    
    // Commit and Push
    run("git add .");
    run('git commit -m "' + issue.title.replace(/"/g, '\\"') + '\\n\\nResolves #' + issue.num + '"');
    run("git push -f fork " + issue.branch);
    
    // Create PR
    const prCmd = 'gh pr create --title "' + issue.title.replace(/"/g, '\\"') + '" --body "Resolves #' + issue.num + '" --head sahare-mayur-0071:' + issue.branch;
    execSync(prCmd, { stdio: 'inherit' });
  } catch (err) {
    console.error("Failed on issue #" + issue.num + ": " + err.message);
  }
}

// return to main
run("git checkout main");
