import subprocess

issues = [
    {
        "title": "feat(backend): Implement structured JSON logging (e.g. Pino or Winston) across all API routes",
        "body": "### Description\nCurrently, the backend relies on basic console.log statements or inconsistent logging mechanisms in various files (excluding 	racker.js which was already updated). Implementing a structured JSON logger like Pino or Winston globally will significantly improve observability, especially when aggregating logs in production.\n\n### Expected Behavior\n- All API routes use a consistent logging utility.\n- Logs are output in structured JSON format.\n- Log levels (info, warn, error) are strictly enforced."
    },
    {
        "title": "feat(flutter): Implement local caching for user profile data (SharedPrefs/Hive)",
        "body": "### Description\nThe Flutter applications currently fetch the user profile from the server on every launch or screen load. Implementing a local caching mechanism (using SharedPreferences or Hive) will reduce network calls, lower backend load, and improve app startup performance.\n\n### Expected Behavior\n- Profile data is cached locally after the first fetch.\n- The app first reads from the cache and then updates it in the background if necessary."
    },
    {
        "title": "feat(flutter): Extract hardcoded string literals into a localization/i18n configuration",
        "body": "### Description\nThroughout the Flutter applications, there are several hardcoded user-facing strings. Extracting these strings into a dedicated localization file (e.g., using intl or lutter_localizations) is essential for maintaining a clean codebase and preparing the app for multi-language support.\n\n### Expected Behavior\n- All user-facing strings are replaced with localization keys.\n- A central localization configuration is established."
    },
    {
        "title": "feat(backend): Add Swagger/OpenAPI documentation for all REST endpoints",
        "body": "### Description\nThe backend lacks a centralized and interactive API documentation interface. Integrating Swagger UI / OpenAPI specifications will help frontend and mobile developers understand the API contracts, test endpoints easily, and reduce integration friction.\n\n### Expected Behavior\n- Swagger UI is available at /api/docs.\n- Core endpoints (orders, trips, drivers, support) are fully documented with request/response schemas."
    },
    {
        "title": "feat(backend): Enforce strict content-type validation for POST/PUT requests",
        "body": "### Description\nThe API does not strictly validate the Content-Type header for all POST and PUT endpoints. Enforcing pplication/json (or other appropriate types) at the middleware level prevents misconfigured clients from sending unexpected payloads and avoids edge-case parsing errors.\n\n### Expected Behavior\n- A global middleware checks Content-Type for mutating requests.\n- Returns a 415 Unsupported Media Type if the header is incorrect."
    },
    {
        "title": "feat(blockchain): Add NatSpec comments to all smart contracts for enhanced documentation",
        "body": "### Description\nThe current Solidity smart contracts lack comprehensive NatSpec (Ethereum Natural Language Specification Format) comments. Adding these will clarify the purpose, parameters, and return values of functions, improving readability and developer onboarding.\n\n### Expected Behavior\n- All public and external functions in smart contracts are documented with @notice, @param, and @return tags."
    },
    {
        "title": "feat(ml): Add strict input tensor shape and type validation in ML endpoints",
        "body": "### Description\nThe machine learning service endpoints currently assume that incoming data perfectly matches the model's expected input dimensions. Adding strict validation for tensor shapes and types before inference will prevent vague backend crashes and provide actionable error messages to the client.\n\n### Expected Behavior\n- Input payloads are verified for correct shape and data types before inference.\n- Descriptive HTTP 400 errors are returned for malformed inputs."
    },
    {
        "title": "feat(ci): Add automated ESLint and Dart Analyzer checks to pull request workflows",
        "body": "### Description\nTo maintain code quality and prevent stylistic or syntactical errors from merging, we should enforce automated linting. Adding a GitHub Actions workflow that runs ESLint for the backend and dart analyze for Flutter apps on every PR will catch issues early.\n\n### Expected Behavior\n- A new CI step runs linting tools.\n- The CI pipeline fails if linting errors are present."
    },
    {
        "title": "feat(backend): Add global CORS configuration middleware",
        "body": "### Description\nThe API requires a standardized Cross-Origin Resource Sharing (CORS) policy to restrict access to trusted domains. Implementing a strict CORS middleware using the cors package will enhance security by preventing unauthorized browser clients from interacting with the API.\n\n### Expected Behavior\n- The cors middleware is applied globally.\n- Allowed origins are configurable via environment variables."
    },
    {
        "title": "test(flutter): Add unit tests for core API integration services",
        "body": "### Description\nThe core API integration services in the Flutter apps lack sufficient unit tests. Writing tests for these services (mocking the HTTP client) will ensure that data parsing and error handling logic remains robust across updates.\n\n### Expected Behavior\n- Unit test coverage is added for key services (e.g., fetching orders, trips).\n- Mock responses are used to test both success and failure cases."
    }
]

for issue in issues:
    print(f"Creating issue: {issue['title']}")
    subprocess.run([
        'gh', 'issue', 'create',
        '--title', issue['title'],
        '--body', issue['body'],
        '--label', 'enhancement,good first issue'
    ])
    print("Done.\\n")

