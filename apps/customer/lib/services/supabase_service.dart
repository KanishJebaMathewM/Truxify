import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseService {
  SupabaseService._();

  static SupabaseClient get client => Supabase.instance.client;

  static User? get currentUser => client.auth.currentUser;

  static String? get currentUserId => currentUser?.id;

  /// Returns the current user's ID, throwing if not authenticated.
  static String requireUserId() {
    final id = currentUserId;
    if (id == null) throw StateError('No authenticated user.');
    return id;
  }
}