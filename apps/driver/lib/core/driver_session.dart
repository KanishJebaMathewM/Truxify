import 'package:supabase_flutter/supabase_flutter.dart';

class DriverSession {
  /// Get the current driver's ID from the Supabase auth session.
  ///
  /// IMPORTANT: This getter provides fallback support for compile-time overrides
  /// via the DRIVER_ID environment variable (dev-only). In production, the auth
  /// session is the only source of truth for driver identity.
  ///
  /// If you need the driver ID, prefer accessing it directly from the auth session:
  ///   final driverId = Supabase.instance.client.auth.currentUser?.id ?? '';
  ///
  /// Compile-time overrides (DRIVER_ID env) are only for local development
  /// and should never be used to make production identity decisions.
  static String get driverId {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) {
      const devOverride = String.fromEnvironment('DRIVER_ID', defaultValue: '');
      return devOverride;
    }
    return user.id;
  }

  /// Helper to safely verify the driver is authenticated.
  /// Returns true only if there is a valid auth session.
  static bool get isAuthenticated =>
      Supabase.instance.client.auth.currentUser != null;

  /// Helper to check if running in dev mode with compile-time override.
  /// Useful for debugging but should never be used for auth decisions.
  static bool get isDevOverride {
    const devOverride = String.fromEnvironment('DRIVER_ID', defaultValue: '');
    return devOverride.isNotEmpty &&
        Supabase.instance.client.auth.currentUser == null;
  }
}