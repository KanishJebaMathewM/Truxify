// apps/customer_app/lib/config/env.dart

class Env {
  static const String supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://your-dev-supabase.supabase.co',
  );
  
  static const String supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: 'dev_anon_key_placeholder',
  );
  
  static const String environment = String.fromEnvironment(
    'ENV',
    defaultValue: 'dev',
  );

  static bool get isProduction => environment == 'prod';
}
