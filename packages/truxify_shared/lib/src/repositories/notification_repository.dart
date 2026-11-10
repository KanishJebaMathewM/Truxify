import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/notification_item.dart';

class NotificationRepositoryException implements Exception {
  NotificationRepositoryException(this.message);

  final String message;

  @override
  String toString() => 'NotificationRepositoryException: $message';
}

class NotificationRepository {
  NotificationRepository(this._client);

  final SupabaseClient _client;

  Future<List<NotificationItem>> fetchNotifications(String userId) async {
    final response = await _client
        .from('notifications')
        .select()
        .eq('user_id', userId)
        .order('created_at', ascending: false);
    final rows = response
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList(growable: false);
    return rows.map(NotificationItem.fromMap).toList();
  }

  Future<void> markNotificationRead(String id, String userId) async {
    final response = await _client
        .from('notifications')
        .update({'is_read': true})
        .eq('id', id)
        .eq('user_id', userId)
        .select();

    if (response.isEmpty) {
      throw NotificationRepositoryException(
        'Failed to mark notification $id as read for user $userId: '
        'no matching writable row was found or the update was rejected.',
      );
    }
  }
}

