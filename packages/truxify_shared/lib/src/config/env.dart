// Environment configuration using --dart-define values injected at build time.
//
// HOW TO RUN (contributors MUST use one of these commands):
//
// Development (local Supabase):
//   flutter run --dart-define=ENV=dev \
//               --dart-define=SUPABASE_URL=http://localhost:54321 \
//               --dart-define=SUPABASE_ANON_KEY=your-local-anon-key
//
// Staging:
//   flutter run --dart-define=ENV=staging \
//               --dart-define=SUPABASE_URL=https://staging.supabase.co \
//               --dart-define=SUPABASE_ANON_KEY=your-staging-anon-key
//
// Production (CI/CD only — NEVER run manually):
//   flutter build apk --dart-define=ENV=prod \
//                     --dart-define=SUPABASE_URL=https://prod.supabase.co \
//                     --dart-define=SUPABASE_ANON_KEY=your-prod-anon-key
//
// ⚠️ NEVER run `flutter run` without --dart-define=ENV=dev
//    Running without flags connects to PRODUCTION services.

class Env {
  // ── Core Environment ──────────────────────────────────────────────────────
  static const String environment = String.fromEnvironment(
    'ENV',
    defaultValue: 'dev',  // Defaults to dev so accidental runs don't hit prod
  );

  static bool get isDev => environment == 'dev';
  static bool get isStaging => environment == 'staging';
  static bool get isProd => environment == 'prod';

  // ── Supabase ───────────────────────────────────────────────────────────────
  static const String supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'http://localhost:54321',  // Supabase local dev default
  );

  static const String supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: '',  // Empty default forces dev to pass the key explicitly
  );

  // ── Backend API ────────────────────────────────────────────────────────────
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000',  // Local Node.js backend
  );

  static const String mlEngineUrl = String.fromEnvironment(
    'ML_ENGINE_URL',
    defaultValue: 'http://localhost:8000',  // Local FastAPI ML engine
  );

  // ── Polygon/Blockchain ─────────────────────────────────────────────────────
  static const String polygonRpcUrl = String.fromEnvironment(
    'POLYGON_RPC_URL',
    defaultValue: 'https://rpc-amoy.polygon.technology',  // Testnet by default
  );

  // ── Validation ────────────────────────────────────────────────────────────
  // Call this in main() to catch missing config early (fail fast, not silently)
  static void validate() {
    final errors = <String>[];

    if (supabaseUrl.isEmpty) {
      errors.add('SUPABASE_URL is not set');
    }
    if (supabaseAnonKey.isEmpty) {
      errors.add('SUPABASE_ANON_KEY is not set');
    }
    if (apiBaseUrl.isEmpty) {
      errors.add('API_BASE_URL is not set');
    }

    if (errors.isNotEmpty) {
      throw Exception(
        '\n\n'
        '═══════════════════════════════════════════════════════════\n'
        '  Truxify Config Error — Missing --dart-define values:\n'
        '═══════════════════════════════════════════════════════════\n'
        '${errors.map((e) => '  ❌ $e').join('\n')}\n'
        '\n'
        '  Run with:\n'
        '  flutter run --dart-define=ENV=dev \\\n'
        '              --dart-define=SUPABASE_URL=http://localhost:54321 \\\n'
        '              --dart-define=SUPABASE_ANON_KEY=your-local-key\n'
        '═══════════════════════════════════════════════════════════\n',
      );
    }

    // In dev mode, warn if accidentally pointed at production URLs
    if (isDev && supabaseUrl.contains('supabase.co') && !supabaseUrl.contains('staging')) {
      // ignore: avoid_print
      print(
        '\n⚠️  WARNING: You are in DEV mode but SUPABASE_URL points to a '
        'non-local Supabase instance. This may be production!\n',
      );
    }
  }
}
