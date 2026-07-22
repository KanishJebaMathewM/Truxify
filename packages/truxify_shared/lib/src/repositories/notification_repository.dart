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
    if (response is! List) {
      throw StateError('Unexpected notifications response type');
    }

    final rows = response.map((item) {
      if (item is Map<String, dynamic>) return item;
      if (item is Map) return Map<String, dynamic>.from(item);
      throw StateError('Unexpected notification item type');
    }).toList(growable: false);
    return rows.map(NotificationItem.fromMap).toList();
  }

  Future<void> markNotificationRead(String id, String userId) async {
    await _client
        .from('notifications')
        .update({'is_read': true})
        .eq('id', id)
        .eq('user_id', userId);
  }
}

