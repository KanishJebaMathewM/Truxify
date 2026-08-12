import 'package:flutter_test/flutter_test.dart';

import 'package:truxify/core/offline/db/offline_event_db.dart';
import 'package:truxify/core/offline/models/trip_event.dart';
import 'package:truxify/core/offline/sync/sync_engine.dart';

class FakeOfflineEventDb extends OfflineEventDb {
  final List<TripEvent> pending = [];
  final List<Map<String, dynamic>> rejected = [];
  final List<Map<String, dynamic>> failed = [];
  final List<String> synced = [];

  @override
  Future<List<TripEvent>> pendingEvents({int limit = 50}) async =>
      pending.take(limit).toList();

  @override
  Future<void> markRejected(String id, {required String reason}) async {
    rejected.add({'id': id, 'reason': reason});
  }

  @override
  Future<void> markFailed(String id, {required int retryCount}) async {
    failed.add({'id': id, 'retryCount': retryCount});
  }

  @override
  Future<void> markSynced(String id) async {
    synced.add(id);
  }

  @override
  Future<void> markSyncing(String id) async {}
}

void main() {
  TripEvent event(String id, {int retryCount = 0}) =>
      TripEvent.gpsUpdate('trip-1', {'lat': 1.0, 'lng': 2.0}, id: id, retryCount: retryCount);

  test('events past maxRetries are rejected with reason, not silently dropped (issue #6282)', () async {
    final db = FakeOfflineEventDb();
    db.pending.add(event('evt-1', retryCount: 5));
    final engine = SyncEngine(
      db: db,
      apiBaseUrl: 'http://localhost:8080',
      maxRetries: 5,
    );

    final uploaded = await engine.syncPending();

    expect(uploaded, 0);
    expect(db.rejected, [
      {'id': 'evt-1', 'reason': 'retry budget exhausted'},
    ]);
    expect(db.failed, isEmpty);
    expect(db.synced, isEmpty);
  });

  test('exhausted events are rejected while eligible events still retry (issue #6282)', () async {
    final db = FakeOfflineEventDb();
    db.pending.add(event('evt-exhausted', retryCount: 5));
    db.pending.add(event('evt-eligible', retryCount: 0));
    final engine = SyncEngine(
      db: db,
      apiBaseUrl: 'http://localhost:8080',
      maxRetries: 5,
    );

    final uploaded = await engine.syncPending();

    expect(uploaded, 0);
    expect(db.rejected, [
      {'id': 'evt-exhausted', 'reason': 'retry budget exhausted'},
    ]);
    // The eligible event still attempts an upload (which cannot succeed in the
    // test environment), so it is retried instead of being skipped.
    expect(db.failed, [
      {'id': 'evt-eligible', 'retryCount': 1},
    ]);
  });
}
