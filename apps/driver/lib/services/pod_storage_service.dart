import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'dart:convert';

class PodRecord {
  final int? id;
  final String orderId;
  final String? signaturePath;
  final String? photoPath;
  final int synced;
  final int createdAt;

  PodRecord({
    this.id,
    required this.orderId,
    this.signaturePath,
    this.photoPath,
    this.synced = 0,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'order_id': orderId,
      'signature_path': signaturePath,
      'photo_path': photoPath,
      'synced': synced,
      'created_at': createdAt,
    };
  }

  factory PodRecord.fromMap(Map<String, dynamic> map) {
    return PodRecord(
      id: map['id'],
      orderId: map['order_id'],
      signaturePath: map['signature_path'],
      photoPath: map['photo_path'],
      synced: map['synced'],
      createdAt: map['created_at'],
    );
  }
}

class PodStorageService {
  static Database? _database;
  static const String tableName = 'pods';

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('pods_cache.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 1,
      onCreate: _createDB,
    );
  }

  Future _createDB(Database db, int version) async {
    await db.execute('''
      CREATE TABLE $tableName (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        signature_path TEXT,
        photo_path TEXT,
        synced INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    ''');
  }

  Future<int> insertPod(PodRecord pod) async {
    final db = await database;
    return await db.insert(tableName, pod.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<PodRecord>> getUnsyncedPods() async {
    final db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      tableName,
      where: 'synced = ?',
      whereArgs: [0],
    );

    return List.generate(maps.length, (i) => PodRecord.fromMap(maps[i]));
  }

  Future<int> markAsSynced(int id) async {
    final db = await database;
    return await db.update(
      tableName,
      {'synced': 1},
      where: 'id = ?',
      whereArgs: [id],
    );
  }
}

final podStorageService = PodStorageService();
