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
}