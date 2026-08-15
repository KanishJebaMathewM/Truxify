import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:mocktail/mocktail.dart';

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

class MockHttpClient extends Mock implements http.Client {}

void main() {
  TripEvent event(String id, {int retryCount = 0}) =>
      TripEvent.gpsUpdate('trip-1', {'lat': 1.0, 'lng': 2.0}, id: id, retryCount: retryCount);

  setUpAll(() {
    registerFallbackValue(Uri.parse('http://localhost'));
  });

  test('401 refreshes token and succeeds on retry (issue #11487)', () async {
    final db = FakeOfflineEventDb();
    db.pending.add(event('evt-1', retryCount: 0));

    final client = MockHttpClient();
    var refreshCalls = 0;
    var postCalls = 0;

    when(() => client.post(any(), headers: any(named: 'headers'), body: any(named: 'body')))
        .thenAnswer((_) async {
      postCalls++;
      return postCalls == 1
          ? http.Response('', 401)
          : http.Response('', 200);
    });

    final engine = SyncEngine(
      db: db,
      apiBaseUrl: 'http://localhost:8080',
      httpClient: client,
      getCurrentToken: () => 'expired-token',
      refreshAuthToken: () async {
        refreshCalls++;
        return 'refreshed-token';
      },
    );

    final uploaded = await engine.syncPending();

    expect(uploaded, 1);
    expect(refreshCalls, 1);
    expect(db.synced, ['evt-1']);
    expect(db.failed, isEmpty);
    expect(db.rejected, isEmpty);
    // Two POSTs: the original 401 attempt and the refreshed retry.
    verify(() => client.post(any(), headers: any(named: 'headers'), body: any(named: 'body')))
        .called(2);
  });

  test('401 with failed refresh re-queues as retryable, not rejected (issue #14734)', () async {
    final db = FakeOfflineEventDb();
    db.pending.add(event('evt-1', retryCount: 0));

    final client = MockHttpClient();

    when(() => client.post(any(), headers: any(named: 'headers'), body: any(named: 'body')))
        .thenAnswer((_) async => http.Response('', 401));

    final engine = SyncEngine(
      db: db,
      apiBaseUrl: 'http://localhost:8080',
      httpClient: client,
      getCurrentToken: () => 'expired-token',
      refreshAuthToken: () async => null,
    );

    final uploaded = await engine.syncPending();

    expect(uploaded, 0);
    // A brief refresh blip must preserve the queued data and be retried later
    // instead of permanently discarding it.
    expect(db.rejected, isEmpty);
    expect(db.failed, [
      {'id': 'evt-1', 'retryCount': 0},
    ]);
    // Refresh failed: the engine must not keep retrying the dead token.
    verify(() => client.post(any(), headers: any(named: 'headers'), body: any(named: 'body')))
        .called(1);
  });

  test('401 after refresh still 401 re-queues as retryable, not rejected (issue #14734)', () async {
    final db = FakeOfflineEventDb();
    db.pending.add(event('evt-1', retryCount: 0));

    final client = MockHttpClient();

    when(() => client.post(any(), headers: any(named: 'headers'), body: any(named: 'body')))
        .thenAnswer((_) async => http.Response('', 401));

    final engine = SyncEngine(
      db: db,
      apiBaseUrl: 'http://localhost:8080',
      httpClient: client,
      getCurrentToken: () => 'expired-token',
      refreshAuthToken: () async => 'refreshed-token',
    );

    final uploaded = await engine.syncPending();

    expect(uploaded, 0);
    // With a refreshed token the auth problem is solved; a subsequent 401 is
    // treated as a retryable transport issue, never a permanent discard.
    expect(db.rejected, isEmpty);
    expect(db.failed, [
      {'id': 'evt-1', 'retryCount': 0},
    ]);
    verify(() => client.post(any(), headers: any(named: 'headers'), body: any(named: 'body')))
        .called(2);
  });
}
