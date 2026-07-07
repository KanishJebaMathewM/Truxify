import { execSync } from 'child_process';

const issues = [
  {
    title: "refactor(flutter): implement json_serializable for robust JSON parsing",
    body: "### Description\nIn `apps/customer/lib/models/app_models.dart`, there is manual type casting like `(json['rating'] as num?)?.toDouble()`. This is prone to runtime errors if the API payload changes. Refactor this and similar models to use `json_serializable` or `freezed` for type-safe and robust JSON parsing.\n\n### Files\n- `apps/customer/lib/models/*.dart`\n- `apps/driver/lib/models/*.dart`\n\n### Type\nrefactor",
    label: "refactor"
  },
  {
    title: "chore(android): configure unique Application ID for production",
    body: "### Description\nThe `build.gradle.kts` files in both driver and customer apps currently have a TODO regarding the Application ID. We need to update this to a production-ready unique identifier (e.g., `com.truxify.customer`) instead of leaving the default placeholder.\n\n### Files\n- `apps/driver/android/app/build.gradle.kts`\n- `apps/customer/android/app/build.gradle.kts`\n\n### Type\nchore",
    label: "chore"
  },
  {
    title: "security(android): set up release signing configuration",
    body: "### Description\nCurrently, there is a `TODO: Add your own signing config for the release build.` in the Android build configurations. For production deployment, we need to securely configure the signing properties (keystore password, alias) using environment variables or `key.properties` without committing secrets to the repo.\n\n### Files\n- `apps/driver/android/app/build.gradle.kts`\n- `apps/customer/android/app/build.gradle.kts`\n\n### Type\nsecurity",
    label: "security"
  },
  {
    title: "feat(analytics): integrate Firebase Crashlytics and Analytics",
    body: "### Description\nWe have a TODO (`TODO: Add the dependencies for Firebase products`) in our gradle files. To monitor app stability and user behavior, integrate Firebase Crashlytics and Analytics into both the customer and driver applications.\n\n### Files\n- `apps/driver/android/app/build.gradle.kts`\n- `apps/customer/android/app/build.gradle.kts`\n\n### Type\nfeature",
    label: "enhancement"
  },
  {
    title: "perf(flutter): optimize coordinate parsing in Live Tracking",
    body: "### Description\nIn `apps/customer/lib/screens/live_tracking_screen.dart`, coordinate parsing is repeated extensively (`(payload['lat'] as num?)?.toDouble()`). Extract this into a reusable utility function to reduce code duplication and improve maintainability.\n\n### Files\n- `apps/customer/lib/screens/live_tracking_screen.dart`\n\n### Type\nperformance",
    label: "performance"
  },
  {
    title: "fix(driver): handle null coordinates from backend gracefully",
    body: "### Description\nIn `apps/driver/lib/services/route_service.dart`, coordinates are cast directly using `(e[0] as num).toDouble()`. If the backend returns an invalid or null coordinate, this will cause a fatal crash. Add null-safety checks and fallback mechanisms.\n\n### Files\n- `apps/driver/lib/services/route_service.dart`\n\n### Type\nbug",
    label: "bug"
  },
  {
    title: "security(backend): implement comprehensive input validation with Zod",
    body: "### Description\nThe backend currently lacks a unified validation layer. To prevent injection attacks and ensure data integrity, integrate `Zod` or `Joi` middleware to validate all incoming request payloads before they reach the controllers.\n\n### Files\n- `backend/api/src/middleware/validationMiddleware.js`\n\n### Type\nsecurity",
    label: "security"
  },
  {
    title: "fix(backend): mask internal stack traces in production error responses",
    body: "### Description\nUnhandled exceptions in the backend may leak stack traces to the client, which is a security risk. Implement a global error handling middleware that logs the full error internally but returns a generic `500 Internal Server Error` message to the client in production mode.\n\n### Files\n- `backend/api/src/app.js`\n- `backend/api/src/middleware/errorHandler.js`\n\n### Type\nbug",
    label: "bug"
  },
  {
    title: "chore(docker): optimize Node.js Dockerfile with multi-stage builds",
    body: "### Description\nThe current backend deployment process could be improved by using multi-stage Docker builds. This will reduce the final image size by excluding `devDependencies` and intermediate build artifacts.\n\n### Files\n- `backend/Dockerfile`\n- `docker-compose.yml`\n\n### Type\nchore",
    label: "chore"
  },
  {
    title: "feat(customer): implement offline-first caching for order history",
    body: "### Description\nCustomers should be able to view their past orders even without an active internet connection. Implement local caching using `Hive` or `sqflite` to store recently fetched orders and sync them when the connection is restored.\n\n### Files\n- `apps/customer/lib/services/order_cache_service.dart`\n\n### Type\nfeature",
    label: "enhancement"
  },
  {
    title: "feat(driver): add exponential backoff for trip status updates",
    body: "### Description\nDrivers often operate in areas with poor network connectivity. If a trip status update fails, the app should automatically retry the request using an exponential backoff strategy instead of silently failing or requiring manual retries.\n\n### Files\n- `apps/driver/lib/services/trip_service.dart`\n\n### Type\nfeature",
    label: "enhancement"
  },
  {
    title: "security(smart-contracts): implement ReentrancyGuard on critical functions",
    body: "### Description\nSmart contracts dealing with escrow and payments are vulnerable to reentrancy attacks. Audit the Solidity contracts and apply OpenZeppelin's `ReentrancyGuard` modifier to all state-changing external functions that handle fund transfers.\n\n### Files\n- `blockchain/contracts/Escrow.sol`\n\n### Type\nsecurity",
    label: "security"
  },
  {
    title: "test(blockchain): add unit tests for token contracts using Hardhat",
    body: "### Description\nThe smart contracts lack comprehensive automated testing. Set up a Hardhat or Foundry testing environment and write unit tests covering minting, transferring, and edge cases to ensure contract reliability.\n\n### Files\n- `blockchain/test/Token.test.js`\n\n### Type\ntest",
    label: "testing"
  },
  {
    title: "security(supabase): configure strict Row Level Security (RLS) policies",
    body: "### Description\nTo protect user privacy, ensure that Supabase Row Level Security (RLS) is strictly configured. Users should only be able to read and modify their own profile data and orders. Verify and document these policies.\n\n### Files\n- `supabase/migrations/`\n\n### Type\nsecurity",
    label: "security"
  },
  {
    title: "chore(database): create automated backup scripts",
    body: "### Description\nWe need a robust disaster recovery plan. Create a shell script to automate periodic database dumps (Postgres/Supabase) and upload them to a secure cloud storage bucket (e.g., AWS S3). Include instructions for setting this up as a cron job.\n\n### Files\n- `scripts/backup_db.sh`\n\n### Type\nchore",
    label: "chore"
  },
  {
    title: "feat(a11y): add accessibility semantics to Flutter core components",
    body: "### Description\nMake the apps more inclusive by adding `Semantics` widgets and ensuring proper contrast ratios for visually impaired users. Focus on interactive elements like buttons, text fields, and navigation bars.\n\n### Files\n- `apps/customer/lib/widgets/`\n- `apps/driver/lib/widgets/`\n\n### Type\nfeature",
    label: "enhancement"
  },
  {
    title: "feat(logging): configure structured JSON logging with Pino",
    body: "### Description\n`console.log` is inadequate for production monitoring. Replace it with `Pino` or `Winston` to output structured JSON logs, which can be easily ingested and parsed by log management systems like ELK or Datadog.\n\n### Files\n- `backend/api/src/utils/logger.js`\n\n### Type\nfeature",
    label: "enhancement"
  },
  {
    title: "security(backend): implement global rate limiting via Redis",
    body: "### Description\nProtect the backend against DoS attacks and brute forcing by implementing a global rate limiting middleware backed by Redis. Ensure that different endpoints (e.g., login vs. fetching data) have appropriate thresholds.\n\n### Files\n- `backend/api/src/middleware/rateLimiter.js`\n\n### Type\nsecurity",
    label: "security"
  },
  {
    title: "chore(ci): configure automated Flutter tests in GitHub Actions",
    body: "### Description\nCurrently, Flutter tests must be run manually. Set up a GitHub Actions workflow to automatically run `flutter test` and `flutter analyze` on every pull request targeting the `main` branch to maintain code quality.\n\n### Files\n- `.github/workflows/flutter-ci.yml`\n\n### Type\nchore",
    label: "chore"
  },
  {
    title: "docs(api): integrate Swagger/OpenAPI for REST endpoints",
    body: "### Description\nAPI documentation is currently scattered or missing. Integrate `swagger-ui-express` and `swagger-jsdoc` to auto-generate and serve an interactive API reference for frontend and mobile developers.\n\n### Files\n- `backend/api/src/docs/swagger.js`\n\n### Type\ndocs",
    label: "documentation"
  },
  {
    title: "feat(driver): implement battery optimization warnings",
    body: "### Description\nLive tracking consumes significant battery. Implement a feature in the driver app that detects low battery levels and warns the driver to plug in their device to ensure uninterrupted service during trips.\n\n### Files\n- `apps/driver/lib/services/battery_service.dart`\n\n### Type\nfeature",
    label: "enhancement"
  },
  {
    title: "feat(i18n): add localization support for customer app",
    body: "### Description\nTo expand into new markets, the customer app needs to support multiple languages. Set up the `flutter_localizations` package and create initial language files (e.g., English, Spanish, French).\n\n### Files\n- `apps/customer/lib/l10n/`\n\n### Type\nfeature",
    label: "enhancement"
  },
  {
    title: "refactor(backend): use environment variables for all secrets",
    body: "### Description\nAudit the codebase to ensure no secrets, API keys, or database credentials are hardcoded. Migrate all such configuration to the `.env` file and update the `README.md` to reflect the required environment variables.\n\n### Files\n- `backend/api/src/config/`\n\n### Type\nrefactor",
    label: "refactor"
  },
  {
    title: "chore(repo): set up Husky pre-commit hooks for linting",
    body: "### Description\nTo enforce coding standards before code is pushed, set up `husky` and `lint-staged` to automatically run `eslint` and `prettier` on staged files during the pre-commit hook.\n\n### Files\n- `package.json`\n- `.husky/pre-commit`\n\n### Type\nchore",
    label: "chore"
  }
];

function run() {
  let createdCount = 0;
  for (const issue of issues) {
    if (createdCount >= 24) break;
    console.log("Creating issue: " + issue.title);
    try {
      // Create issue
      const cmd = 'gh issue create --title "' + issue.title.replace(/"/g, '\\"') + '" --body "' + issue.body.replace(/"/g, '\\"') + '" --label "' + issue.label + '"';
      const output = execSync(cmd, { encoding: 'utf-8' }).trim();
      console.log("Successfully created issue: " + output);
      
      // Extract issue URL and number
      const issueUrl = output;
      const issueNumber = issueUrl.split('/').pop();
      
      // Comment for GSSoC assignment
      console.log("Commenting on issue #" + issueNumber + " for GSSoC assignment...");
      const commentCmd = 'gh issue comment ' + issueNumber + ' --body "Hi, I would like to work on this issue under GSSoC. Please assign it to me."';
      execSync(commentCmd, { encoding: 'utf-8' });
      console.log("Commented successfully on #" + issueNumber);
      
      createdCount++;
    } catch (err) {
      console.error("Failed to create or comment on issue: " + err.message);
    }
  }
}

run();
