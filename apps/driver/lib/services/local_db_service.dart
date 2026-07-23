import 'dart:io';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';
import 'package:path_provider/path_provider.dart';

class LocalDbService {
  static final LocalDbService instance = LocalDbService._init();
  static Database? _database;

  LocalDbService._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('truxify_driver.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 2,
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
  }

  Future<void> _upgradeDB(Database db, int oldVersion, int newVersion) async {
    if (oldVersion < 2) {
      await db.execute('ALTER TABLE pending_pods ADD COLUMN order_id TEXT');
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
