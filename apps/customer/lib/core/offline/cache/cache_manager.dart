
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

class CacheManager {
  static const String _dbName = 'truxify_cache.db';

  static const Set<String> _cacheTables = {
    'orders',
    'profile',
    'documents',
    'settings',
    'last_location',
    'milestones',
  };

  static const Set<String> _activeStatuses = {
    'pending',
    'active',
    'truck_assigned',
    'en_route_pickup',
    'arrived_pickup',
    'picked_up',
    'in_transit',
    'arriving',
  };

  Database? _database;

  // Testing support.
  @visibleForTesting
  set databaseForTesting(Database? db) => _database = db;

  String? _stableId(
    Map<String, dynamic> item,
    List<String> keys,
  ) {
    for (final key in keys) {
      final value = item[key]?.toString().trim();

      if (value != null && value.isNotEmpty) {
        return value;
      }
    }

    return null;
  }

  dynamic _safeDecode(String json) {
    try {
      return jsonDecode(json);
    } catch (e, stackTrace) {
      developer.log(
        'CacheManager: Failed to decode cached JSON.',
        error: e,
        stackTrace: stackTrace,
      );
      return null;
    }
  }

  Map<String, dynamic>? _decodeMap(String json) {
    final decoded = _safeDecode(json);

    if (decoded is Map) {
      return Map<String, dynamic>.from(decoded);
    }

    return null;
  }

  static List<Map<String, dynamic>> filterActiveOrders(
    List<Map<String, dynamic>> results, {
    required int limit,
  }) {
    if (limit <= 0) return [];

    return results
        .where(
          (item) => _activeStatuses.contains(
            item['status']?.toString(),
          ),
        )
        .take(limit)
        .toList();
  }

  Future<Database> open() async {
    if (_database != null && _database!.isOpen) {
      return _database!;
    }

    final databasesPath = await getDatabasesPath();
    final dbPath = p.join(databasesPath, _dbName);

    _database = await openDatabase(
      dbPath,
      version: 2,
      onCreate: (db, version) async {
        await _createTables(db);
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await db.execute(
            'ALTER TABLE orders ADD COLUMN status TEXT',
          );

          await db.execute(
            'CREATE INDEX IF NOT EXISTS idx_orders_status '
            'ON orders(status)',
          );
        }
      },
    );

    return _database!;
  }

  Future<void> _createTables(Database db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE INDEX IF NOT EXISTS idx_orders_status
      ON orders(status)
    ''');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS profile (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS last_location (
        id TEXT PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        updated_at TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS milestones (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        title TEXT NOT NULL,
        completed INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    ''');
  }

  // ORDER CACHE

  Future<void> cacheOrders(
    List<Map<String, dynamic>> orders,
  ) async {
    final db = await open();
    final batch = db.batch();

    final updatedAt = DateTime.now().toUtc().toIso8601String();

    for (final item in orders) {
      final id = _stableId(
        item,
        const [
          'id',
          'orderId',
          'order_id',
          'order_display_id',
        ],
      );

      if (id == null) continue;

      batch.insert(
        'orders',
        {
          'id': id,
          'type': item['type'] ?? 'order',
          'status': item['status']?.toString(),
          'payload': jsonEncode(item),
          'updated_at': updatedAt,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    await batch.commit(noResult: true);
  }

  Future<List<Map<String, dynamic>>> getOrders({
    bool activeOnly = false,
    int limit = 20,
  }) async {
    if (limit <= 0) return [];

    final db = await open();

    // Fetch all rows before applying the active-order limit.
    final rows = await db.query(
      'orders',
      orderBy: 'updated_at DESC',
    );

    final results = <Map<String, dynamic>>[];

    for (final row in rows) {
      final payload = _decodeMap(row['payload'] as String);

      if (payload == null) {
        final id = row['id'];

        if (id is String) {
          await db.delete(
            'orders',
            where: 'id = ?',
            whereArgs: [id],
          );
        }

        continue;
      }

      results.add({
        ...payload,
        'status': row['status'] ?? payload['status'],
        '_cached_at': row['updated_at'],
      });
    }

    if (activeOnly) {
      return filterActiveOrders(
        results,
        limit: limit,
      );
    }

    return results.take(limit).toList();
  }

  // PROFILE CACHE

  Future<void> cacheProfile(
    Map<String, dynamic> profile,
  ) async {
    final db = await open();

    await db.insert(
      'profile',
      {
        'key': 'profile',
        'value': jsonEncode(profile),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<Map<String, dynamic>?> getProfile() async {
    final db = await open();

    final rows = await db.query(
      'profile',
      where: 'key = ?',
      whereArgs: ['profile'],
      limit: 1,
    );

    if (rows.isEmpty) return null;

    final decoded = _decodeMap(
      rows.first['value'] as String,
    );

    if (decoded == null) {
      await db.delete(
        'profile',
        where: 'key = ?',
        whereArgs: ['profile'],
      );

      return null;
    }

    return {
      ...decoded,
      '_cached_at': rows.first['updated_at'],
    };
  }

  // DOCUMENT CACHE

  Future<void> cacheDocuments(
    List<Map<String, dynamic>> documents,
  ) async {
    final db = await open();
    final batch = db.batch();

    final updatedAt = DateTime.now().toUtc().toIso8601String();

    for (final item in documents) {
      final id = _stableId(
        item,
        const ['id', 'documentId'],
      );

      if (id == null) continue;

      batch.insert(
        'documents',
        {
          'id': id,
          'title': item['title'] ?? 'Document',
          'payload': jsonEncode(item),
          'updated_at': updatedAt,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    await batch.commit(noResult: true);
  }

  Future<List<Map<String, dynamic>>> getDocuments() async {
    final db = await open();

    final rows = await db.query(
      'documents',
      orderBy: 'updated_at DESC',
    );

    final results = <Map<String, dynamic>>[];

    for (final row in rows) {
      final payload = _decodeMap(
        row['payload'] as String,
      );

      if (payload == null) {
        await db.delete(
          'documents',
          where: 'id = ?',
          whereArgs: [row['id']],
        );

        continue;
      }

      results.add({
        ...payload,
        '_cached_at': row['updated_at'],
      });
    }

    return results;
  }

  // SETTINGS CACHE

  Future<void> cacheSettings(
    Map<String, dynamic> settings,
  ) async {
    final db = await open();
    final batch = db.batch();

    final updatedAt = DateTime.now().toUtc().toIso8601String();

    for (final entry in settings.entries) {
      batch.insert(
        'settings',
        {
          'key': entry.key,
          'value': jsonEncode(entry.value),
          'updated_at': updatedAt,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    await batch.commit(noResult: true);
  }

  Future<Map<String, dynamic>> getSettings() async {
    final db = await open();

    final rows = await db.query('settings');
    final result = <String, dynamic>{};

    for (final row in rows) {
      final key = row['key'] as String;
      final decoded = _safeDecode(
        row['value'] as String,
      );

      if (decoded == null) {
        await db.delete(
          'settings',
          where: 'key = ?',
          whereArgs: [key],
        );

        continue;
      }

      result[key] = decoded;
    }

    return result;
  }

  // LOCATION CACHE

  Future<void> cacheLastLocation(
    double latitude,
    double longitude,
  ) async {
    final db = await open();

    await db.insert(
      'last_location',
      {
        'id': 'latest',
        'latitude': latitude,
        'longitude': longitude,
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<Map<String, dynamic>?> getLastLocation() async {
    final db = await open();

    final rows = await db.query(
      'last_location',
      where: 'id = ?',
      whereArgs: ['latest'],
      limit: 1,
    );

    if (rows.isEmpty) return null;

    final row = rows.first;

    return {
      'latitude': row['latitude'],
      'longitude': row['longitude'],
      'updated_at': row['updated_at'],
    };
  }

  // MILESTONE CACHE

  Future<void> cacheMilestones(
    String orderId,
    List<Map<String, dynamic>> milestones,
  ) async {
    final db = await open();

    final updatedAt = DateTime.now().toUtc().toIso8601String();

    await db.transaction((txn) async {
      // Remove old milestones for this order.
      await txn.delete(
        'milestones',
        where: 'order_id = ?',
        whereArgs: [orderId],
      );

      final batch = txn.batch();

      for (var index = 0; index < milestones.length; index++) {
        final item = milestones[index];

        final milestoneId = _stableId(
              item,
              const [
                'id',
                'milestoneId',
                'milestone_id',
              ],
            ) ??
            '${item['title'] ?? 'milestone'}_$index';

        batch.insert(
          'milestones',
          {
            'id': '${orderId}_$milestoneId',
            'order_id': orderId,
            'title': item['title'] ?? 'Milestone',
            'completed': item['completed'] == true ? 1 : 0,
            'updated_at': updatedAt,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }

      await batch.commit(noResult: true);
    });
  }

  Future<List<Map<String, dynamic>>> getMilestones(
    String orderId,
  ) async {
    final db = await open();

    final rows = await db.query(
      'milestones',
      where: 'order_id = ?',
      whereArgs: [orderId],
      orderBy: 'updated_at DESC',
    );

    return rows.map((row) {
      return {
        'title': row['title'],
        'completed': row['completed'] == 1,
        'updated_at': row['updated_at'],
      };
    }).toList();
  }

  // CACHE MANAGEMENT

  Future<String?> getLastUpdatedLabel(
    String tableName,
  ) async {
    if (!_cacheTables.contains(tableName)) {
      throw ArgumentError.value(
        tableName,
        'tableName',
        'Unknown cache table',
      );
    }

    final db = await open();

    final rows = await db.query(
      tableName,
      orderBy: 'updated_at DESC',
      limit: 1,
    );

    return rows.isEmpty
        ? null
        : rows.first['updated_at'] as String?;
  }

  Future<int> clearTable(String tableName) async {
    if (!_cacheTables.contains(tableName)) {
      throw ArgumentError.value(
        tableName,
        'tableName',
        'Unknown cache table',
      );
    }

    final db = await open();
    return db.delete(tableName);
  }

  Future<void> clearAll() async {
    final db = await open();

    await db.transaction((txn) async {
      for (final table in _cacheTables) {
        await txn.delete(table);
      }
    });
  }

  Future<int> removeStaleOrders({
    Duration maxAge = const Duration(days: 7),
  }) async {
    final db = await open();

    final cutoff = DateTime.now()
        .toUtc()
        .subtract(maxAge)
        .toIso8601String();

    return db.delete(
      'orders',
      where: 'updated_at < ?',
      whereArgs: [cutoff],
    );
  }

  Future<int> getCacheSize(String tableName) async {
    if (!_cacheTables.contains(tableName)) {
      throw ArgumentError.value(
        tableName,
        'tableName',
        'Unknown cache table',
      );
    }

    final db = await open();

    final result = await db.rawQuery(
      'SELECT COUNT(*) AS cnt FROM $tableName',
    );

    if (result.isEmpty) return 0;

    return (result.first['cnt'] as int?) ?? 0;
  }

  Future<Map<String, int>> getAllTableSizes() async {
    final result = <String, int>{};

    for (final table in _cacheTables) {
      result[table] = await getCacheSize(table);
    }

    return result;
  }

  // CLOSE DATABASE

  Future<void> close() async {
    await _database?.close();
    _database = null;
  }
}

