

 
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as path;
import 'package:sqflite/sqflite.dart';

/// Unified local storage service for the customer application.
///
/// Provides a common API for local persistence using SQLite.
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

/// SQLite implementation for mobile platforms.
class LocalStorageServiceImpl implements LocalStorageService {
  Database? _database;
  Future<Database>? _opening;

  /// Initializes the local SQLite database.
  @override
  Future<void> initialize() async {
    if (kIsWeb) {
      throw UnsupportedError(
        'SQLite storage is not supported by this implementation on Web. '
        'Provide a separate web storage implementation.',
      );
    }

    if (_database != null) return;

    _opening ??= _openDatabase();

    try {
      _database = await _opening!;
    } catch (_) {
      _opening = null;
      rethrow;
    }
  }

  Future<Database> _openDatabase() async {
    final directory = await getDatabasesPath();
    final databasePath = path.join(directory, 'customer.db');

    return openDatabase(
      databasePath,
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

  /// Returns the initialized database.
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

  /// Validates table names before using them in SQL operations.
  String _validateTable(String table) {
    final validName = RegExp(r'^[A-Za-z_][A-Za-z0-9_]*$');

    if (!validName.hasMatch(table)) {
      throw ArgumentError.value(table, 'table', 'Invalid table name');
    }

    return table;
  }

  // ---------------- CRUD OPERATIONS ----------------

  @override
  Future<int> insert(
    String table,
    Map<String, dynamic> values,
  ) {
    return _db.insert(
      _validateTable(table),
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
    if (limit != null && limit < 0) {
      throw ArgumentError.value(limit, 'limit');
    }

    return _db.query(
      _validateTable(table),
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
      _validateTable(table),
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
      _validateTable(table),
      where: where,
      whereArgs: whereArgs,
    );
  }

  @override
  Future<void> clear(String table) async {
    await _db.delete(_validateTable(table));
  }

  // ---------------- KEY-VALUE STORAGE ----------------

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

  // ---------------- DATABASE CLEANUP ----------------

  @override
  Future<void> close() async {
    final opening = _opening;
    Database? database = _database;

    if (database == null && opening != null) {
      database = await opening;
    }

    _database = null;
    _opening = null;

    await database?.close();
  }
}
