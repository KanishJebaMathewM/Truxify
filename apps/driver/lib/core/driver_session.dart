import 'package:supabase_flutter/supabase_flutter.dart';

class DriverSession {
  /// Tracks when the current session was started.
  /// Mutable — set to `DateTime.now()` on login so callers can detect
  /// stale sessions without relying on the Supabase token alone.
  static DateTime? sessionStartedAt;

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
    if (user == null) {
      throw StateError('No authenticated driver session.');
    }
    return user.id;
  }

  /// True only when there is a valid Supabase auth session.
  static bool get isAuthenticated =>
      Supabase.instance.client.auth.currentUser != null;

  /// Safely casts a raw value to [Map<String, dynamic>].
  /// Returns an empty map instead of throwing when the cast is invalid.
  static Map<String, dynamic> safeCastToMap(dynamic value) {
    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }
    return <String, dynamic>{};
  }

  /// Safely casts a raw list to `List<Map<String, dynamic>>`.
  /// Returns an empty list instead of throwing when the cast is invalid.
  static List<Map<String, dynamic>> safeCastToMapList(dynamic value) {
    if (value is List) {
      return value
          .map((e) => e is Map ? Map<String, dynamic>.from(e) : <String, dynamic>{})
          .toList();
    }
    return <Map<String, dynamic>>[];
  }
}
