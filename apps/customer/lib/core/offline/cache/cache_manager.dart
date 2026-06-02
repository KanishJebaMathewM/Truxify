import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

class CacheManager {
  static const _dbName = 'truxify_cache.db';

  Database? _database;

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
      batch.insert(
        'orders',
        {
          'id': item['id'] ?? item['orderId'] ?? item['order_id'],
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

    final results = rows.map((row) {
      final payload = jsonDecode(row['payload'] as String) as Map<String, dynamic>;
      return <String, dynamic>{
        ...payload,
        '_cached_at': row['updated_at'],
      };
    }).toList();

    if (activeOnly) {
      return results.where((item) => item['status'] == 'active' || item['status'] == 'in_transit').toList();
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

    final payload = jsonDecode(rows.first['value'] as String) as Map<String, dynamic>;
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
      batch.insert(
        'documents',
        {
          'id': item['id'] ?? item['documentId'],
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
    return rows.map((row) {
      final payload = jsonDecode(row['payload'] as String) as Map<String, dynamic>;
      return <String, dynamic>{
        ...payload,
        '_cached_at': row['updated_at'],
      };
    }).toList();
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
      result[row['key'] as String] = jsonDecode(row['value'] as String);
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

    for (final item in milestones) {
      batch.insert(
        'milestones',
        {
          'id': '${orderId}_${item['title'] ?? 'milestone'}',
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

  Future<void> close() async {
    await _database?.close();
    _database = null;
  }
}
