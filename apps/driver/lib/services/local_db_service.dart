import 'dart:io';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';
import 'package:path_provider/path_provider.dart';

class LocalDbService {
  static final LocalDbService instance = LocalDbService._init();
  static Database? _database;
  static Future<Database>? _pendingInit;

  LocalDbService._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _pendingInit ??= _initDB('truxify_driver.db');
    _database = await _pendingInit;
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 3,
      onCreate: _createDB,
      onUpgrade: _upgradeDB,
    );
  }

  Future _createDB(Database db, int version) async {
    const idType = 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const textType = 'TEXT NOT NULL';
    const textTypeNull = 'TEXT';
    const intType = 'INTEGER NOT NULL';

    await db.execute('''
CREATE TABLE pending_pods (
  id $idType,
  order_id $textTypeNull,
  trip_display_id $textType,
  stop_id $textType,
  photo_path $textTypeNull,
  signature_path $textTypeNull,
  timestamp $intType,
  sync_status $intType
)
''');
    await _createLocationQueueTable(db);
  }

  /// Durable offline queue for driver location pings and geofence milestones.
  ///
  /// Every row is one undelivered item that must survive application restarts.
  /// Milestones use a stable `idempotency_key` (`milestone:{orderId}:{milestone}`)
  /// which is UNIQUE so re-enqueueing the same logical milestone is a no-op.
  /// Location rows use a `null` key (SQLite UNIQUE permits multiple NULLs) —
  /// their dedup/coalescing is handled at the app layer.
  Future<void> _createLocationQueueTable(Database db) async {
    await db.execute('''
CREATE TABLE IF NOT EXISTS location_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  driver_id TEXT,
  order_id TEXT,
  order_display_id TEXT,
  milestone TEXT,
  idempotency_key TEXT UNIQUE,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
)
''');
  }

  Future<void> _upgradeDB(Database db, int oldVersion, int newVersion) async {
    if (oldVersion < 2) {
      await db.execute('ALTER TABLE pending_pods ADD COLUMN order_id TEXT');
    }
    if (oldVersion < 3) {
      await _createLocationQueueTable(db);
    }
  }

  Future<void> insertPendingPoD(Map<String, dynamic> podData) async {
    final db = await instance.database;
    await db.insert('pending_pods', podData);
  }

  Future<List<Map<String, dynamic>>> getPendingPoDs() async {
    final db = await instance.database;
    return await db.query('pending_pods', where: 'sync_status = ?', whereArgs: [0]);
  }

  Future<void> markPoDSynced(int id) async {
    final db = await instance.database;
    await db.update(
      'pending_pods',
      {'sync_status': 1},
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> clearSyncedPoDs() async {
    final db = await instance.database;
    await db.delete('pending_pods', where: 'sync_status = ?', whereArgs: [1]);
  }

  Future<void> deletePendingPoD(int id) async {
    final db = await instance.database;
    await db.delete('pending_pods', where: 'id = ?', whereArgs: [id]);
  }
}
