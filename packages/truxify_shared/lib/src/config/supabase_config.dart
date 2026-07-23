/// Configuration for Supabase client.
/// Extracts values passed via --dart-define environment variables.
class SupabaseConfig {
  /// Supabase project URL.
  static const String url = String.fromEnvironment('SUPABASE_URL', defaultValue: '');

  /// Supabase anonymous key.
  static const String publishableKey = String.fromEnvironment('SUPABASE_ANON_KEY', defaultValue: '');

  /// Returns true if the Supabase URL and Anon Key are properly configured.
  static bool get isConfigured => url.isNotEmpty && publishableKey.isNotEmpty;
}
