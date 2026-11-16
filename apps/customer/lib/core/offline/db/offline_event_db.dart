
import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/trip_event.dart';

class OfflineDbStats {
  final int totalEvents;
  final int pendingEvents;
  final int syncedEvents;

  const OfflineDbStats({
    required this.totalEvents,
    required this.pendingEvents,
    required this.syncedEvents,
  });

  static Future<OfflineDbStats> collect(Database db) async {
    final total = Sqflite.firstIntValue(
          await db.rawQuery('SELECT COUNT(*) FROM trip_events'),
        ) ??
        0;

    final pending = Sqflite.firstIntValue(
          await db.rawQuery(
            "SELECT COUNT(*) FROM trip_events "
            "WHERE sync_status IN ('pending', 'failed')",
          ),
        ) ??
        0;

    final synced = Sqflite.firstIntValue(
          await db.rawQuery(
            "SELECT COUNT(*) FROM trip_events WHERE sync_status = 'synced'",
          ),
        ) ??
        0;

    return OfflineDbStats(
      totalEvents: total,
      pendingEvents: pending,
      syncedEvents: synced,
    );
  }
}

class OfflineEventDb {
  static const String _tableName = 'trip_events';
  static const String _dbName = 'truxify_trip_events.db';

  Database? _database;
  Future<Database>? _opening;

  Future<Database> open() async {
    final current = _database;

    if (current != null && current.isOpen) {
      return current;
    }

    final existingOpening = _opening;
    if (existingOpening != null) {
      return existingOpening;
    }

    final future = _openDatabase();
    _opening = future;

    try {
      return await future;
    } finally {
      if (identical(_opening, future)) {
        _opening = null;
      }
    }
  }

  Future<Database> _openDatabase() async {
    final databasesPath = await getDatabasesPath();
    final dbPath = p.join(databasesPath, _dbName);

    final db = await openDatabase(
      dbPath,
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
            retry_count INTEGER NOT NULL DEFAULT 0,
            last_retry_at TEXT,
            sync_error TEXT
          )
        ''');

        await _createIndexes(db);
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await db.execute(
            'ALTER TABLE $_tableName ADD COLUMN sync_error TEXT',
          );
        }

        await _createIndexes(db);
      },
    );

    _database = db;
    return db;
  }

  Future<void> _createIndexes(Database db) async {
    await db.execute('''
      CREATE INDEX IF NOT EXISTS idx_trip_events_status
      ON $_tableName(sync_status)
    ''');

    await db.execute('''
      CREATE INDEX IF NOT EXISTS idx_trip_events_occurred_at
      ON $_tableName(occurred_at)
    ''');

    await db.execute('''
      CREATE INDEX IF NOT EXISTS idx_trip_events_trip_id
      ON $_tableName(trip_id)
    ''');
  }

  Future<void> insert(TripEvent event) async {
    final db = await open();

    final data = Map<String, dynamic>.from(event.toJson());
    data['payload'] = jsonEncode(event.payload);

    await db.insert(
      _tableName,
      data,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<TripEvent>> pendingEvents({
    int limit = 50,
  }) async {
    if (limit <= 0) return [];

    final db = await open();

    final rows = await db.query(
      _tableName,
      where: 'sync_status IN (?, ?)',
      whereArgs: ['pending', 'failed'],
      orderBy: 'occurred_at ASC, id ASC',
      limit: limit,
    );

    return rows.map(
      (row) => TripEvent.fromJson(
        Map<String, dynamic>.from(row),
      ),
    ).toList();
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

  /// Resets events left in the syncing state after an interrupted upload.
  Future<int> reconcileStuckSyncing() async {
    final db = await open();

    return db.update(
      _tableName,
      {'sync_status': 'pending'},
      where: 'sync_status = ?',
      whereArgs: ['syncing'],
    );
  }

  Future<void> markSynced(String id) async {
    final db = await open();

    await db.update(
      _tableName,
      {
        'sync_status': 'synced',
        'last_retry_at': null,
        'sync_error': null,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> markFailed(
    String id, {
    required int retryCount,
    String? error,
  }) async {
    final db = await open();

    await db.update(
      _tableName,
      {
        'sync_status': 'failed',
        'retry_count': retryCount < 0 ? 0 : retryCount,
        'last_retry_at': DateTime.now().toUtc().toIso8601String(),
        'sync_error': error,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> markRejected(
    String id, {
    required String reason,
  }) async {
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
    final opening = _opening;

    if (opening != null) {
      try {
        await opening;
      } catch (_) {
        // Ignore opening errors while closing.
      }
    }

    final db = _database;
    _database = null;

    if (db != null && db.isOpen) {
      await db.close();
    }
  }
}

