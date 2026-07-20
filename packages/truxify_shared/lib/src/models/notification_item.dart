class NotificationItem {
  const NotificationItem({
    required this.id,
    this.userId,
    required this.title,
    required this.body,
    required this.notifType,
    required this.isRead,
    required this.createdAt,
    this.metadata,
  });

  final String id;
  final String? userId;
  final String title;
  final String body;
  final String notifType;
  final bool isRead;
  final DateTime? createdAt;
  final Map<String, dynamic>? metadata;

  /// Order display ID extracted from [metadata], if present.
  String? get orderId => metadata?['order_display_id']?.toString();

  /// Trip ID extracted from [metadata], if present.
  String? get tripId => metadata?['trip_id']?.toString();

  /// Bid ID extracted from [metadata], if present.
  String? get bidId => metadata?['bid_id']?.toString();

  factory NotificationItem.fromMap(Map<String, dynamic> map) {
    return NotificationItem(
      id: map['id']?.toString() ?? '',
      userId: map['user_id']?.toString(),
      title: map['title']?.toString() ?? '',
      body: map['body']?.toString() ?? '',
      notifType: map['notif_type']?.toString() ?? 'general',
      isRead: map['is_read'] as bool? ?? false,
      createdAt: DateTime.tryParse(map['created_at']?.toString() ?? ''),
      metadata: map['metadata'] is Map<String, dynamic>
          ? map['metadata'] as Map<String, dynamic>
          : null,
    );
  }

  /// Creates a copy with the given fields replaced.
  NotificationItem copyWith({
    String? id,
    String? userId,
    String? title,
    String? body,
    String? notifType,
    bool? isRead,
    DateTime? createdAt,
    Map<String, dynamic>? metadata,
  }) {
    return NotificationItem(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      title: title ?? this.title,
      body: body ?? this.body,
      notifType: notifType ?? this.notifType,
      isRead: isRead ?? this.isRead,
      createdAt: createdAt ?? this.createdAt,
      metadata: metadata ?? this.metadata,
    );
  }
}

