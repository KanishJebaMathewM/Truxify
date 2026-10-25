import 'package:flutter/foundation.dart';
import 'package:sqflite/sqflite.dart';

/// Unified local storage service for the customer application.
///
/// Provides a common API for local persistence while keeping the
/// platform-specific database implementation behind this abstraction.
abstract class LocalStorageService {
  Future<void> initialize();

  Future<int> insert(
    String table,
    Map<String, dynamic> values,
  );

  Future<List<Map<String, dynamic>>> query(
    String table, {
    String? where,
    List<Object?>? whereArgs,
    String? orderBy,
    int? limit,
  });

  Future<int> update(
    String table,
    Map<String, dynamic> values, {
    String? where,
    List<Object?>? whereArgs,
  });

  Future<int> delete(
    String table, {
    String? where,
    List<Object?>? whereArgs,
  });

  Future<void> clear(String table);

  Future<void> setValue(String key, String value);

  Future<String?> getValue(String key);

  Future<void> removeValue(String key);

  Future<void> close();
}

/// Default implementation.
///
/// NOTE:
/// This file defines the shared contract. Platform-specific implementations
/// should be provided through conditional imports so that sqflite is never
/// loaded by the Flutter Web runtime.
class LocalStorageServiceImpl implements LocalStorageService {
  Database? _database;

  @override
  Future<void> initialize() async {
    if (kIsWeb) {
      throw UnsupportedError(
        'Web storage implementation must be provided by '
        'local_storage_web.dart.',
      );
    }

    _database = await openDatabase(
      'customer.db',
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE IF NOT EXISTS key_value (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        ''');
      },
    );
  }

  Database get _db {
    final database = _database;

    if (database == null) {
      throw StateError(
        'LocalStorageService has not been initialized. '
        'Call initialize() first.',
      );
    }

    return database;
  }

  @override
  Future<int> insert(
    String table,
    Map<String, dynamic> values,
  ) {
    return _db.insert(
      table,
      values,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  @override
  Future<List<Map<String, dynamic>>> query(
    String table, {
    String? where,
    List<Object?>? whereArgs,
    String? orderBy,
    int? limit,
  }) {
    return _db.query(
      table,
      where: where,
      whereArgs: whereArgs,
      orderBy: orderBy,
      limit: limit,
    );
  }

  @override
  Future<int> update(
    String table,
    Map<String, dynamic> values, {
    String? where,
    List<Object?>? whereArgs,
  }) {
    return _db.update(
      table,
      values,
      where: where,
      whereArgs: whereArgs,
    );
  }

  @override
  Future<int> delete(
    String table, {
    String? where,
    List<Object?>? whereArgs,
  }) {
    return _db.delete(
      table,
      where: where,
      whereArgs: whereArgs,
    );
  }

  @override
  Future<void> clear(String table) async {
    await _db.delete(table);
  }

  @override
  Future<void> setValue(String key, String value) async {
    await _db.insert(
      'key_value',
      {
        'key': key,
        'value': value,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  @override
  Future<String?> getValue(String key) async {
    final result = await _db.query(
      'key_value',
      columns: ['value'],
      where: 'key = ?',
      whereArgs: [key],
      limit: 1,
    );

    if (result.isEmpty) {
      return null;
    }

    return result.first['value'] as String?;
  }

  @override
  Future<void> removeValue(String key) async {
    await _db.delete(
      'key_value',
      where: 'key = ?',
      whereArgs: [key],
    );
  }

  @override
  Future<void> close() async {
    final database = _database;

    if (database != null && database.isOpen) {
      await database.close();
    }

    _database = null;
  }
}
