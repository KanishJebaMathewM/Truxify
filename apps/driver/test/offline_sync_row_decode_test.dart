import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/offline_sync_event_model.dart';

/// Regression tests for issue #12426: `sync_events` rows were read with
/// non-nullable `as` casts, so a single NULL or mistyped column threw a
/// `TypeError` out of the whole read.
void main() {
  Map<String, Object?> row({
    Object? eventId = 'EVT-1',
    Object? eventType = 'STATUS_UPDATE',
    Object? payload = '{"trip_id":"T-1"}',
    Object? queuedAt = 1700000000000,
    Object? isSynced = 0,
    Object? syncedAt,
  }) {
    return {
      'event_id': eventId,
      'event_type': eventType,
      'payload': payload,
      'queued_at': queuedAt,
      'is_synced': isSynced,
      'synced_at': syncedAt,
      'retry_count': 0,
      'state': 'pending',
    };
  }

  group('OfflineSyncEvent.fromRow', () {
    test('decodes a well-formed row', () {
      final event = OfflineSyncEvent.fromRow(row())!;

      expect(event.eventId, 'EVT-1');
      expect(event.eventType, 'STATUS_UPDATE');
      expect(event.payload, {'trip_id': 'T-1'});
      expect(event.queuedAt.millisecondsSinceEpoch, 1700000000000);
      expect(event.isSynced, isFalse);
      expect(event.syncedAt, isNull);
    });

    test('reads sync markers when the row is marked synced', () {
      final event = OfflineSyncEvent.fromRow(
        row(isSynced: 1, syncedAt: 1700000009999),
      )!;

      expect(event.isSynced, isTrue);
      expect(event.syncedAt!.millisecondsSinceEpoch, 1700000009999);
    });

    test('returns null instead of throwing on a NULL required column', () {
      expect(OfflineSyncEvent.fromRow(row(eventId: null)), isNull);
      expect(OfflineSyncEvent.fromRow(row(eventType: null)), isNull);
      expect(OfflineSyncEvent.fromRow(row(payload: null)), isNull);
      expect(OfflineSyncEvent.fromRow(row(queuedAt: null)), isNull);
    });

    test('returns null instead of throwing on a mistyped column', () {
      expect(OfflineSyncEvent.fromRow(row(eventId: 42)), isNull);
      expect(OfflineSyncEvent.fromRow(row(eventType: 42)), isNull);
      expect(OfflineSyncEvent.fromRow(row(payload: 42)), isNull);
      expect(OfflineSyncEvent.fromRow(row(queuedAt: '1700000000000')), isNull);
    });

    test('returns null on an empty identity or type', () {
      expect(OfflineSyncEvent.fromRow(row(eventId: '')), isNull);
      expect(OfflineSyncEvent.fromRow(row(eventType: '')), isNull);
    });

    test('returns null when the payload is not a JSON object', () {
      // jsonDecode throws FormatException here rather than a cast error, which
      // the reported `as` casts would not have caught either.
      expect(OfflineSyncEvent.fromRow(row(payload: 'not json')), isNull);
      expect(OfflineSyncEvent.fromRow(row(payload: '')), isNull);
      // Valid JSON, but not an object: the `as Map<String, dynamic>` cast.
      expect(OfflineSyncEvent.fromRow(row(payload: '[1,2,3]')), isNull);
      expect(OfflineSyncEvent.fromRow(row(payload: '"a string"')), isNull);
    });

    test('treats advisory sync columns as "not synced" rather than dropping',
        () {
      // is_synced/synced_at never address a row or reach the backend, so a bad
      // value degrades to a resend that the idempotency key absorbs.
      final nullMarkers = OfflineSyncEvent.fromRow(row(isSynced: null))!;
      expect(nullMarkers.isSynced, isFalse);

      final badMarkers =
          OfflineSyncEvent.fromRow(row(isSynced: 'yes', syncedAt: 'nope'))!;
      expect(badMarkers.isSynced, isFalse);
      expect(badMarkers.syncedAt, isNull);
    });

    test('one corrupt row no longer aborts the surrounding read', () {
      final rows = [
        row(eventId: 'EVT-1'),
        row(eventId: null), // partial write / schema drift
        row(eventId: 'EVT-2', payload: 'not json'),
        row(eventId: 'EVT-3'),
      ];

      // The pre-fix mapping: an unguarded cast over the same result set.
      expect(
        () => rows
            .map((r) => OfflineSyncEvent(
                  eventId: r['event_id'] as String,
                  eventType: r['event_type'] as String,
                  payload:
                      jsonDecode(r['payload'] as String) as Map<String, dynamic>,
                  queuedAt: DateTime.fromMillisecondsSinceEpoch(
                      r['queued_at'] as int),
                ))
            .toList(),
        throwsA(isA<TypeError>()),
      );

      // The fixed mapping keeps every well-formed event.
      final decoded = rows
          .map(OfflineSyncEvent.fromRow)
          .whereType<OfflineSyncEvent>()
          .toList();

      expect(decoded.map((e) => e.eventId), ['EVT-1', 'EVT-3']);
    });
  });
}
