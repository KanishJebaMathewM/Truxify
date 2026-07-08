import 'package:supabase_flutter/supabase_flutter.dart';

class DriverSession {
  static String get driverId {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) {
      const devOverride = String.fromEnvironment('DRIVER_ID', defaultValue: '');
      return devOverride;
    }
    return user.id;
  }

  static String? get driverEmail {
    final user = Supabase.instance.client.auth.currentUser;
    return user?.email;
  }

  static String? get driverPhone {
    final user = Supabase.instance.client.auth.currentUser;
    return user?.phone;
  }

  static bool get isLoggedIn {
    return Supabase.instance.client.auth.currentUser != null;
  }

  static Map<String, dynamic>? get userMetadata {
    return Supabase.instance.client.auth.currentUser?.userMetadata;
  }

  static String? get displayName {
    final meta = userMetadata;
    return meta?['full_name'] as String? ?? driverEmail ?? driverPhone;
  }

  static Future<void> refreshSession() async {
    final response = await Supabase.instance.client.auth.refreshSession();
    if (response.error != null) {
      throw Exception('Session refresh failed: ${response.error!.message}');
    }
  }

  static Future<void> signOut() async {
    await Supabase.instance.client.auth.signOut();
  }

  static Future<bool> checkAndRefresh() async {
    try {
      final user = Supabase.instance.client.auth.currentUser;
      if (user == null) return false;
      final expiresAt = user.createdAt;
      if (expiresAt.isBefore(DateTime.now().subtract(const Duration(hours: 1)))) {
        await refreshSession();
      }
      return true;
    } catch (_) {
      return false;
    }
  }
}