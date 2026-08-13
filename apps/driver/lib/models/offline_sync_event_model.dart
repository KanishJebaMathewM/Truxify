import 'dart:convert';

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

  /// Decodes one `sync_events` row into an event, or returns `null` when the
  /// row cannot be trusted.
  ///
  /// Rows can drift from the schema through a partial write, a schema change
  /// or an interrupted migration. Reading such a row with a non-nullable `as`
  /// throws, and because the callers map over a whole result set one bad row
  /// used to abort the entire read (issue #12426). Returning `null` lets the
  /// caller drop that single row and keep going.
  ///
  /// Identity and content columns are required rather than defaulted:
  /// `event_id` addresses the row in every UPDATE/DELETE and doubles as the
  /// backend idempotency key, `payload`/`event_type` are the event itself, and
  /// `queued_at` is sent as `occurred_at`. Substituting a placeholder for any
  /// of them would push wrong data to the backend or target the wrong row, so
  /// an undecodable row is dropped instead. `is_synced` and `synced_at` are
  /// advisory, so they fall back to "not synced" — the worst case is a resend
  /// that the idempotency key absorbs.
  static OfflineSyncEvent? fromRow(Map<String, Object?> row) {
    final eventId = row['event_id'];
    final eventType = row['event_type'];
    final rawPayload = row['payload'];
    final queuedAt = row['queued_at'];

    if (eventId is! String || eventId.isEmpty) return null;
    if (eventType is! String || eventType.isEmpty) return null;
    if (rawPayload is! String) return null;
    if (queuedAt is! int) return null;

    Object? payload;
    try {
      payload = jsonDecode(rawPayload);
    } on FormatException {
      return null;
    }
    if (payload is! Map<String, dynamic>) return null;

    final syncedAt = row['synced_at'];
    return OfflineSyncEvent(
      eventId: eventId,
      eventType: eventType,
      payload: payload,
      queuedAt: DateTime.fromMillisecondsSinceEpoch(queuedAt),
      isSynced: row['is_synced'] == 1,
      syncedAt:
          syncedAt is int ? DateTime.fromMillisecondsSinceEpoch(syncedAt) : null,
    );
  }
}
