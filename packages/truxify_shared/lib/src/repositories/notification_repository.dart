import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/notification_item.dart';

class NotificationRepository {
  NotificationRepository(this._client);

  final SupabaseClient _client;

  Future<List<NotificationItem>> fetchNotifications(String userId) async {
    final response = await _client
        .from('notifications')
        .select()
        .eq('user_id', userId)
        .order('created_at', ascending: false);
    final rows = (response as List<dynamic>).cast<Map<String, dynamic>>();
    return rows.map(NotificationItem.fromMap).toList();
  }

  Future<void> markNotificationRead(String id) async {
    await _client.from('notifications').update({'is_read': true}).eq('id', id);
  }
}

