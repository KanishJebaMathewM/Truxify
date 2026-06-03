class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.userId,
    required this.title,
    required this.body,
    required this.notifType,
    required this.isRead,
    required this.createdAt,
  });

  final String id;
  final String? userId;
  final String title;
  final String body;
  final String notifType;
  final bool isRead;
  final DateTime? createdAt;

  factory NotificationItem.fromMap(Map<String, dynamic> map) {
    return NotificationItem(
      id: map['id']?.toString() ?? '',
      userId: map['user_id']?.toString(),
      title: map['title']?.toString() ?? '',
      body: map['body']?.toString() ?? '',
      notifType: map['notif_type']?.toString() ?? 'general',
      isRead: map['is_read'] as bool? ?? false,
      createdAt: DateTime.tryParse(map['created_at']?.toString() ?? ''),
    );
  }
}

