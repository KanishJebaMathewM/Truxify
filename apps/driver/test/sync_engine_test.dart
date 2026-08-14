import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:truxify_driver/services/sync_engine.dart';

const _connectivityChannel = MethodChannel(
  'dev.fluttercommunity.plus/connectivity',
);

void _setConnectivity(List<String> results) {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(_connectivityChannel, (call) async {
    if (call.method == 'check') return results;
    return null;
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    _setConnectivity(['none']);
  });

  group('SyncEngine.apiBaseUrl', () {
    test('defaults to localhost when TRUXIFY_API_BASE_URL is not injected', () {
      expect(SyncEngine.apiBaseUrl, 'http://localhost:5000');
    });
  });

  group('SyncEngine database', () {
    test('initializes with the sync_queue schema', () async {
      final db = await SyncEngine.database;
      final tables = await db.rawQuery(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='sync_queue'",
      );

      expect(tables, hasLength(1));
      final sql = tables.first['sql'] as String;
      expect(sql, contains('id TEXT PRIMARY KEY'));
      expect(sql, contains('trip_id TEXT'));
      expect(sql, contains('event_type TEXT NOT NULL'));
      expect(sql, contains('payload TEXT NOT NULL'));
      expect(sql, contains('occurred_at TEXT NOT NULL'));
    });

    test('queueEvent enqueues an event with tripId, eventType and payload', () async {
      final db = await SyncEngine.database;
      await db.delete('sync_queue');

      await SyncEngine.queueEvent(
        tripId: 'trip-1',
        eventType: 'milestone',
        payload: {'milestone': 'Arrived at Pickup', 'attempts': 3},
      );

      final rows = await db.query('sync_queue');
      expect(rows, hasLength(1));
      expect(rows.first['trip_id'], 'trip-1');
      expect(rows.first['event_type'], 'milestone');
      expect(rows.first['id'], isNotEmpty);
      expect(rows.first['occurred_at'], isNotEmpty);
      expect(
        jsonDecode(rows.first['payload'] as String),
        {'milestone': 'Arrived at Pickup', 'attempts': 3},
      );
    });

    test('queued events are returned in occurred_at order', () async {
      final db = await SyncEngine.database;
      await db.delete('sync_queue');

      await SyncEngine.queueEvent(tripId: 'trip-1', eventType: 'pickup', payload: const {'m': 1});
      await Future<void>.delayed(const Duration(milliseconds: 2));
      await SyncEngine.queueEvent(tripId: 'trip-1', eventType: 'delivery', payload: const {'m': 2});

      final rows = await db.query('sync_queue', orderBy: 'occurred_at ASC');
      expect(rows.map((r) => r['event_type']), ['pickup', 'delivery']);
    });

    test('attemptSync does not drain the queue while offline', () async {
      final db = await SyncEngine.database;
      await db.delete('sync_queue');
      await SyncEngine.queueEvent(tripId: 'trip-1', eventType: 'milestone', payload: const {});

      await SyncEngine.attemptSync();

      final rows = await db.query('sync_queue');
      expect(rows, hasLength(1));
    });

    test('attemptSync completes when the queue is empty', () async {
      final db = await SyncEngine.database;
      await db.delete('sync_queue');

      await expectLater(SyncEngine.attemptSync(), completes);

      final rows = await db.query('sync_queue');
      expect(rows, isEmpty);
    });
  });
}
