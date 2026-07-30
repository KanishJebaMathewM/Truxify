class OfflineSyncEvent {
  final String eventId;
  final String eventType; // 'STATUS_UPDATE', 'LOCATION_PING', 'POD_UPLOAD'
  final Map<String, dynamic> payload;
  final DateTime queuedAt;
  final bool isSynced;
  final DateTime? syncedAt;

  OfflineSyncEvent({
    required this.eventId,
    required this.eventType,
    required this.payload,
    required this.queuedAt,
    this.isSynced = false,
    this.syncedAt,
  });
}
