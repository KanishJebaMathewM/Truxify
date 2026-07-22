import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/trip_event.dart';

class OfflineDbStats {
  int totalEvents = 0;
  int pendingEvents = 0;
  int syncedEvents = 0;

  static Future<OfflineDbStats> collect(Database db) async {
    final total = Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM trip_events')) ?? 0;
    final pending = Sqflite.firstIntValue(await db.rawQuery("SELECT COUNT(*) FROM trip_events WHERE sync_status = 'pending'")) ?? 0;
    return OfflineDbStats()
      ..totalEvents = total
      ..pendingEvents = pending
      ..syncedEvents = total - pending;
  }
}

class OfflineEventDb {
  static const _tableName = 'trip_events';

  Database? _database;

  Future<Database> open() async {
    if (_database != null) {
      return _database!;
    }

    final databasesPath = await getDatabasesPath();
    final path = p.join(databasesPath, 'truxify_trip_events.db');

    _database = await openDatabase(
      path,
      version: 2,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE $_tableName (
            id TEXT PRIMARY KEY,
            trip_id TEXT NOT NULL,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            sync_status TEXT NOT NULL,
            retry_count INTEGER NOT NULL,
            last_retry_at TEXT,
            sync_error TEXT
          )
        ''');
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await db.execute('ALTER TABLE $_tableName ADD COLUMN sync_error TEXT');
        }
      },
    );

    return _database!;
  }

  Future<void> insert(TripEvent event) async {
    final db = await open();
    await db.insert(
      _tableName,
      event.toJson()..['payload'] = jsonEncode(event.payload),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<TripEvent>> pendingEvents({int limit = 50}) async {
    final db = await open();
    final rows = await db.query(
      _tableName,
      where: 'sync_status IN (?, ?)',
      whereArgs: ['pending', 'failed'],
      orderBy: 'occurred_at ASC',
      limit: limit,
    );

    return rows.map(TripEvent.fromJson).toList();
  }

  Future<void> markSyncing(String id) async {
    final db = await open();
    await db.update(
      _tableName,
      {'sync_status': 'syncing'},
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> markSynced(String id) async {
    final db = await open();
    await db.update(
      _tableName,
      {'sync_status': 'synced', 'last_retry_at': null, 'sync_error': null},
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> markFailed(String id, {required int retryCount}) async {
    final db = await open();
    await db.update(
      _tableName,
      {
        'sync_status': 'failed',
        'retry_count': retryCount,
        'last_retry_at': DateTime.now().toUtc().toIso8601String(),
        'sync_error': null,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> markRejected(String id, {required String reason}) async {
    final db = await open();
    await db.update(
      _tableName,
      {
        'sync_status': 'rejected',
        'sync_error': reason,
        'last_retry_at': DateTime.now().toUtc().toIso8601String(),
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> close() async {
    await _database?.close();
    _database = null;
  }
}
