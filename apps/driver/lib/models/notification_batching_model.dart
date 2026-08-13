class ContextNotification {
  final String id;
  final String title;
  final String message;
  final bool isUrgent;
  final DateTime timestamp;

  ContextNotification({
    required this.id,
    required this.title,
    required this.message,
    required this.isUrgent,
    required this.timestamp,
  });
}

class NotificationBatchingSession {
  final double currentSpeedMph;
  final List<ContextNotification> deliveredNotifications; // Shown immediately
  final List<ContextNotification> batchedQueue; // Held back until stopped

  NotificationBatchingSession({
    required this.currentSpeedMph,
    required this.deliveredNotifications,
    required this.batchedQueue,
  });
}
