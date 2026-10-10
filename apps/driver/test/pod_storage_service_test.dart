import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as path;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:truxify_driver/services/pod_storage_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  group('PodRecord', () {
    test('creates PodRecord with required fields', () {
      final record = PodRecord(orderId: 'order-123', createdAt: 1234567890);

      expect(record.orderId, 'order-123');
      expect(record.signaturePath, isNull);
      expect(record.photoPath, isNull);
      expect(record.synced, 0);
      expect(record.createdAt, 1234567890);
    });

    test('creates PodRecord with all fields', () {
      final record = PodRecord(
        id: 1,
        orderId: 'order-123',
        signaturePath: '/path/to/sign.png',
        photoPath: '/path/to/photo.jpg',
        synced: 1,
        createdAt: 1234567890,
      );

      expect(record.id, 1);
      expect(record.orderId, 'order-123');
      expect(record.signaturePath, '/path/to/sign.png');
      expect(record.photoPath, '/path/to/photo.jpg');
      expect(record.synced, 1);
      expect(record.createdAt, 1234567890);
    });

    test('toMap produces correct map', () {
      final record = PodRecord(
        id: 1,
        orderId: 'order-123',
        signaturePath: '/path/to/sign.png',
        photoPath: '/path/to/photo.jpg',
        synced: 0,
        createdAt: 1234567890,
      );

      final map = record.toMap();
      expect(map['id'], 1);
      expect(map['order_id'], 'order-123');
      expect(map['signature_path'], '/path/to/sign.png');
      expect(map['photo_path'], '/path/to/photo.jpg');
      expect(map['synced'], 0);
      expect(map['created_at'], 1234567890);
    });

    test('fromMap creates PodRecord correctly', () {
      final map = {
        'id': 2,
        'order_id': 'order-456',
        'signature_path': '/sig/path',
        'photo_path': '/photo/path',
        'synced': 1,
        'created_at': 9876543210,
      };

      final record = PodRecord.fromMap(map);
      expect(record.id, 2);
      expect(record.orderId, 'order-456');
      expect(record.signaturePath, '/sig/path');
      expect(record.photoPath, '/photo/path');
      expect(record.synced, 1);
      expect(record.createdAt, 9876543210);
    });

    test('fromMap handles null optional fields', () {
      final map = {
        'id': 3,
        'order_id': 'order-789',
        'signature_path': null,
        'photo_path': null,
        'synced': 0,
        'created_at': 1111111111,
      };

      final record = PodRecord.fromMap(map);
      expect(record.signaturePath, isNull);
      expect(record.photoPath, isNull);
    });
  });

  group('POD database migration', () {
    late Directory tempDirectory;

    setUp(() async {
      tempDirectory = await Directory.systemTemp.createTemp('truxify-pods-');
    });

    tearDown(() async {
      await tempDirectory.delete(recursive: true);
    });

    test('upgrades version 1 without losing pending or synced PODs', () async {
      final databasePath = path.join(tempDirectory.path, 'pods.db');
      final oldDb = await openDatabase(
        databasePath,
        version: 1,
        onCreate: (db, version) async {
          await db.execute('''
            CREATE TABLE pods (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_id TEXT NOT NULL,
              signature_path TEXT,
              photo_path TEXT,
              synced INTEGER DEFAULT 0,
              created_at INTEGER NOT NULL
            )
          ''');
        },
      );
      await oldDb.insert('pods', {
        'order_id': 'pending-order',
        'signature_path': '/signature.png',
        'synced': 0,
        'created_at': 123,
      });
      await oldDb.insert('pods', {
        'order_id': 'synced-order',
        'synced': 1,
        'created_at': 456,
      });
      await oldDb.close();

      final upgradedDb = await openDatabase(
        databasePath,
        version: PodStorageService.schemaVersion,
        onCreate: PodStorageService.createDatabase,
        onUpgrade: PodStorageService.upgradeDatabase,
      );
      try {
        final rows = await upgradedDb.query('pods', orderBy: 'id');
        expect(rows.map((row) => row['order_id']).toList(), [
          'pending-order',
          'synced-order',
        ]);
        expect(rows.first['signature_path'], '/signature.png');
        expect(rows.map((row) => row['synced']).toList(), [0, 1]);
        expect(rows.map((row) => row['created_at']).toList(), [123, 456]);
        expect(await upgradedDb.getVersion(), PodStorageService.schemaVersion);
        await _expectIndexes(upgradedDb);
      } finally {
        await upgradedDb.close();
      }
    });

    test('creates the indexes on a fresh database', () async {
      final db = await openDatabase(
        path.join(tempDirectory.path, 'new-pods.db'),
        version: PodStorageService.schemaVersion,
        onCreate: PodStorageService.createDatabase,
        onUpgrade: PodStorageService.upgradeDatabase,
      );
      try {
        await _expectIndexes(db);
      } finally {
        await db.close();
      }
    });
  });
}

Future<void> _expectIndexes(Database db) async {
  final indexes = await db.rawQuery('PRAGMA index_list(pods)');
  expect(
    indexes.map((index) => index['name']).toList(),
    containsAll([
      'idx_pods_synced',
      'idx_pods_order_id',
      'idx_pods_created_at',
    ]),
  );
}
