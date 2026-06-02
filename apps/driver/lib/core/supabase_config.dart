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
