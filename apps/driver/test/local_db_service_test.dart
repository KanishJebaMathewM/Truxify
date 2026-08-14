import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:truxify_driver/services/local_db_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  tearDown(() async {
    final db = await LocalDbService.instance.database;
    await db.delete('pending_pods');
    await db.delete('location_queue');
  });

  group('LocalDbService schema', () {
    test('creates pending_pods and location_queue tables', () async {
      final db = await LocalDbService.instance.database;
      final tables = await db.rawQuery(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
        "('pending_pods', 'location_queue')",
      );

      expect(
        tables.map((t) => t['name']),
        containsAll(['pending_pods', 'location_queue']),
      );
    });

    test('location_queue enforces a unique idempotency_key', () async {
      final db = await LocalDbService.instance.database;
      const row = {
        'kind': 'milestone',
        'order_id': 'o1',
        'idempotency_key': 'milestone:o1:Arriving',
        'payload': '{}',
        'created_at': 1,
      };

      await db.insert('location_queue', row);

      expect(
        () => db.insert('location_queue', row),
        throwsA(isA<DatabaseException>()),
      );
    });
  });

  group('LocalDbService pending PoDs', () {
    test('insertPendingPoD stores a row retrievable as pending', () async {
      await LocalDbService.instance.insertPendingPoD({
        'order_id': 'o1',
        'trip_display_id': 'TRIP-1',
        'stop_id': 's1',
        'photo_path': '/tmp/a.jpg',
        'timestamp': 123,
        'sync_status': 0,
      });

      final pending = await LocalDbService.instance.getPendingPoDs();
      expect(pending, hasLength(1));
      expect(pending.first['trip_display_id'], 'TRIP-1');
      expect(pending.first['order_id'], 'o1');
      expect(pending.first['photo_path'], '/tmp/a.jpg');
    });

    test('getPendingPoDs excludes already-synced rows', () async {
      final db = await LocalDbService.instance.database;
      await db.insert('pending_pods', {
        'trip_display_id': 'TRIP-2',
        'stop_id': 'sx',
        'timestamp': 1,
        'sync_status': 1,
      });

      final pending = await LocalDbService.instance.getPendingPoDs();
      expect(pending, isEmpty);
    });

    test('markPoDSynced flips sync_status and clearSyncedPoDs removes it', () async {
      await LocalDbService.instance.insertPendingPoD({
        'trip_display_id': 'TRIP-3',
        'stop_id': 's2',
        'timestamp': 2,
        'sync_status': 0,
      });
      final pending = await LocalDbService.instance.getPendingPoDs();
      final id = pending.first['id'] as int;

      await LocalDbService.instance.markPoDSynced(id);

      expect(await LocalDbService.instance.getPendingPoDs(), isEmpty);

      await LocalDbService.instance.clearSyncedPoDs();

      final rows = await (await LocalDbService.instance.database).query('pending_pods');
      expect(rows, isEmpty);
    });

    test('deletePendingPoD removes the row', () async {
      await LocalDbService.instance.insertPendingPoD({
        'trip_display_id': 'TRIP-4',
        'stop_id': 's3',
        'timestamp': 3,
        'sync_status': 0,
      });
      final pending = await LocalDbService.instance.getPendingPoDs();
      final id = pending.first['id'] as int;

      await LocalDbService.instance.deletePendingPoD(id);

      expect(await LocalDbService.instance.getPendingPoDs(), isEmpty);
    });
  });
}
