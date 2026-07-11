import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseService {
  SupabaseService._();

  static SupabaseClient? mockClient;

  static SupabaseClient get client => mockClient ?? Supabase.instance.client;

  static User? get currentUser => client.auth.currentUser;

  static String? get currentUserId => currentUser?.id;

  static String? get currentUserEmail => currentUser?.email;

  static String? get currentUserPhone => currentUser?.phone;

  static bool get isAuthenticated => currentUser != null;

  static Map<String, dynamic>? get userMetadata => currentUser?.userMetadata;

  /// Returns the current user's ID, throwing if not authenticated.
  static String requireUserId() {
    final id = currentUserId;
    if (id == null) throw StateError('No authenticated user.');
    return id;
  }

  static Future<AuthResponse> signUp({
    required String email,
    required String password,
    Map<String, dynamic>? metadata,
  }) async {
    return client.auth.signUp(
      email: email,
      password: password,
      data: metadata,
    );
  }

  static Future<AuthResponse> signInWithEmail({
    required String email,
    required String password,
  }) async {
    return client.auth.signInWithPassword(email: email, password: password);
  }

  static Future<AuthResponse> signInWithOtp(String phone) async {
    return client.auth.signInWithOtp(phone: phone);
  }

  static Future<void> signOut() async {
    await client.auth.signOut();
  }

  static Future<PostgrestResponse> executeRawQuery(String table, {
    String? select,
    String? eqColumn,
    dynamic eqValue,
    int? limit,
    bool? ascending,
    String? orderColumn,
  }) async {
    var query = client.from(table).select(select ?? '*');
    if (eqColumn != null && eqValue != null) {
      query = query.eq(eqColumn, eqValue);
    }
    if (orderColumn != null) {
      query = query.order(orderColumn, ascending: ascending ?? false);
    }
    if (limit != null) {
      query = query.limit(limit);
    }
    return query;
  }

  static RealtimeChannel subscribeToChannel({
    required String table,
    required String event,
    required void Function(Map<String, dynamic> payload) onEvent,
    String? filterColumn,
    dynamic filterValue,
  }) {
    var filter = RealtimeListenTypes.postgresChanges;
    var channel = client.channel('$table-changes');
    channel.onPostgresChanges(
      table: table,
      schema: 'public',
      callback: (payload) => onEvent(payload.newRecord),
    );
    channel.subscribe();
    return channel;
  }
}