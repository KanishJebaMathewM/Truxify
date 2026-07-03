import 'package:supabase_flutter/supabase_flutter.dart';

class DriverSession {
  /// Get the current driver's ID from the Supabase auth session.
  ///
  /// Returns an empty string when there is no authenticated user. There is
  /// intentionally no compile-time fallback here: a build-time DRIVER_ID
  /// constant baked into a release APK would let any unauthenticated code
  /// path silently act as a specific driver (see documents_screen.dart's
  /// `DriverSession.driverId.isNotEmpty` login check, which would treat a
  /// signed-out device as logged in). Identity must always come from the
  /// live auth session.
  static String get driverId {
    final user = Supabase.instance.client.auth.currentUser;
    return user?.id ?? '';
  }

  /// True only when there is a valid Supabase auth session.
  static bool get isAuthenticated =>
      Supabase.instance.client.auth.currentUser != null;
}
