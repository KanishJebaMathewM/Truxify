/// Configuration for Supabase client.
/// Extracts values passed via --dart-define environment variables.
class SupabaseConfig {
  /// Supabase project URL.
  static const String url = String.fromEnvironment('SUPABASE_URL');

  /// Supabase anonymous key.
  static const String anonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

  /// Helper to check if credentials are provided.
  static bool get isConfigured => url.isNotEmpty && anonKey.isNotEmpty;
}
class SupabaseSettings {
  static const Duration defaultTimeout = Duration(seconds: 30);
  static const int maxRetries = 3;
  static const Duration retryDelay = Duration(seconds: 1);
  static const bool enableRealtime = true;
  static const bool persistSession = true;
  static const bool autoRefreshToken = true;

  static Duration get timeout => Duration(seconds: int.tryParse(env('SUPABASE_TIMEOUT_SECONDS') ?? '') ?? 30);
  static int get retries => int.tryParse(env('SUPABASE_MAX_RETRIES') ?? '') ?? maxRetries;
  static bool get debugLogging => env('SUPABASE_DEBUG') == 'true';

  static String? env(String key) => const String.fromEnvironment(key);
}
