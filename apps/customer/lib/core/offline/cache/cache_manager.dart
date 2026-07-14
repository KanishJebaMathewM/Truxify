import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

class CacheManager {
  static const Set<String> _cacheTables = {
    'orders',
    'profile',
    'documents',
    'settings',
    'last_location',
    'milestones',
  };

  dynamic _safeDecode(String json) {
    try {
      return jsonDecode(json);
    } catch (_) {
      return null;
    }
  }

  Map<String, dynamic>? _decodeMap(String json) {
    final decoded = _safeDecode(json);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
    if (decoded is Map) {
      return Map<String, dynamic>.from(decoded);
    }
    return null;
  }

  static const _dbName = 'truxify_cache.db';

  Database? _database;

  String? _stableId(Map<String, dynamic> item, List<String> keys) {
    for (final key in keys) {
      final value = item[key]?.toString().trim();
      if (value != null && value.isNotEmpty) {
        return value;
      }
    }
    return null;
  }

  Future<Database> open() async {
    if (_database != null) {
      return _database!;
    }

    final databasesPath = await getDatabasesPath();
    final path = p.join(databasesPath, _dbName);

    _database = await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
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
      },
    );

    return _database!;
  }

  Future<void> cacheOrders(List<Map<String, dynamic>> orders) async {
    final db = await open();
    final batch = db.batch();
    final updatedAt = DateTime.now().toUtc().toIso8601String();

    for (final item in orders) {
      final id = _stableId(item, const ['id', 'orderId', 'order_id']);
      if (id == null) {
        continue;
      }

      batch.insert(
        'orders',
        {
          'id': id,
          'type': item['type'] ?? 'order',
          'payload': jsonEncode(item),
          'updated_at': updatedAt,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    await batch.commit(noResult: true);
  }

  Future<List<Map<String, dynamic>>> getOrders({bool activeOnly = false, int limit = 20}) async {
    final db = await open();
    final rows = await db.query(
      'orders',
      orderBy: 'updated_at DESC',
      limit: limit,
    );

    final results = <Map<String, dynamic>>[];

    for (final row in rows) {
      final payload = _decodeMap(row['payload'] as String);
      if (payload == null) {
        final id = row['id'];
        if (id is String) {
          await db.delete('orders', where: 'id = ?', whereArgs: [id]);
        }
        continue;
      }

      results.add(<String, dynamic>{
        ...payload,
        '_cached_at': row['updated_at'],
      });
    }

    if (activeOnly) {
      const activeStatuses = {
        'pending',
        'active',
        'truck_assigned',
        'en_route_pickup',
        'arrived_pickup',
        'picked_up',
        'in_transit',
        'arriving'
      };
      return results.where((item) => activeStatuses.contains(item['status'])).toList();
    }

    return results;
  }

  Future<void> cacheProfile(Map<String, dynamic> profile) async {
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
    final rows = await db.query('profile', where: 'key = ?', whereArgs: ['profile'], limit: 1);
    if (rows.isEmpty) {
      return null;
    }

    final decoded = _safeDecode(rows.first['value'] as String);
    if (decoded is! Map) {
      await db.delete('profile', where: 'key = ?', whereArgs: ['profile']);
      return null;
    }

    final payload = Map<String, dynamic>.from(decoded);
    return <String, dynamic>{
      ...payload,
      '_cached_at': rows.first['updated_at'],
    };
  }

  Future<void> cacheDocuments(List<Map<String, dynamic>> documents) async {
    final db = await open();
    final batch = db.batch();
    final updatedAt = DateTime.now().toUtc().toIso8601String();

    for (final item in documents) {
      final id = _stableId(item, const ['id', 'documentId']);
      if (id == null) {
        continue;
      }

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
    final rows = await db.query('documents', orderBy: 'updated_at DESC');

    final results = <Map<String, dynamic>>[];
    for (final row in rows) {
      final decoded = _safeDecode(row['payload'] as String);
      if (decoded is! Map) {
        final id = row['id'];
        if (id is String) {
          await db.delete('documents', where: 'id = ?', whereArgs: [id]);
        }
        continue;
      }

      final payload = Map<String, dynamic>.from(decoded);
      results.add(<String, dynamic>{
        ...payload,
        '_cached_at': row['updated_at'],
      });
    }

    return results;
  }

  Future<void> cacheSettings(Map<String, dynamic> settings) async {
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
      final decoded = _safeDecode(row['value'] as String);
      if (decoded == null) {
        await db.delete('settings', where: 'key = ?', whereArgs: [key]);
        continue;
      }
      result[key] = decoded;
    }

    return result;
  }

  Future<void> cacheLastLocation(double latitude, double longitude) async {
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
    final rows = await db.query('last_location', where: 'id = ?', whereArgs: ['latest'], limit: 1);
    if (rows.isEmpty) {
      return null;
    }

    final row = rows.first;
    return {
      'latitude': row['latitude'],
      'longitude': row['longitude'],
      'updated_at': row['updated_at'],
    };
  }

  Future<void> cacheMilestones(String orderId, List<Map<String, dynamic>> milestones) async {
    final db = await open();
    final batch = db.batch();
    final updatedAt = DateTime.now().toUtc().toIso8601String();

    for (var index = 0; index < milestones.length; index++) {
      final item = milestones[index];
      final milestoneId = _stableId(item, const ['id', 'milestoneId', 'milestone_id']) ??
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
  }

  Future<List<Map<String, dynamic>>> getMilestones(String orderId) async {
    final db = await open();
    final rows = await db.query('milestones', where: 'order_id = ?', whereArgs: [orderId], orderBy: 'updated_at DESC');
    return rows.map((row) => {
      'title': row['title'],
      'completed': row['completed'] == 1,
      'updated_at': row['updated_at'],
    }).toList();
  }

  Future<String?> getLastUpdatedLabel(String tableName) async {
    final db = await open();
    final rows = await db.query(tableName, orderBy: 'updated_at DESC', limit: 1);
    return rows.isEmpty ? null : rows.first['updated_at'] as String?;
  }

  Future<int> clearTable(String tableName) async {
    if (!_cacheTables.contains(tableName)) {
      throw ArgumentError.value(tableName, 'tableName', 'unknown cache table');
    }
    final db = await open();
    return db.delete(tableName);
  }

  Future<void> clearAll() async {
    final db = await open();
    await db.delete('orders');
    await db.delete('profile');
    await db.delete('documents');
    await db.delete('settings');
    await db.delete('last_location');
    await db.delete('milestones');
  }

  Future<int> removeStaleOrders({Duration maxAge = const Duration(days: 7)}) async {
    final db = await open();
    final cutoff = DateTime.now().toUtc().subtract(maxAge).toIso8601String();
    return db.delete('orders', where: 'updated_at < ?', whereArgs: [cutoff]);
  }

  Future<int> getCacheSize(String tableName) async {
    if (!_cacheTables.contains(tableName)) {
      throw ArgumentError.value(tableName, 'tableName', 'unknown cache table');
    }
    final db = await open();
    final result = await db.rawQuery('SELECT COUNT(*) as cnt FROM $tableName');
    if (result.isEmpty) return 0;
    return (result.first['cnt'] as int?) ?? 0;
  }

  Future<Map<String, int>> getAllTableSizes() async {
    final tables = ['orders', 'profile', 'documents', 'settings', 'last_location', 'milestones'];
    final result = <String, int>{};
    for (final table in tables) {
      result[table] = await getCacheSize(table);
    }
    return result;
  }

  Future<void> close() async {
    await _database?.close();
    _database = null;
  }
}
