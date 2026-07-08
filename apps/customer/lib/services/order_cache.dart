import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';

class OrderCache {
  static Database? _db;

  static Future<Database> get database async {
    if (_db != null) return _db!;
    _db = await _initDB();
    return _db!;
  }

  static Future<Database> _initDB() async {
    String path = join(await getDatabasesPath(), 'order_cache.db');
    return await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute(
          '''
          CREATE TABLE orders(
            id TEXT PRIMARY KEY,
            data TEXT,
            timestamp INTEGER
          )
          '''
        );
      },
    );
  }

  static Future<void> cacheOrders(List<Map<String, dynamic>> orders) async {
    final db = await database;
    Batch batch = db.batch();
    
    // Clear old cache before inserting new
    batch.delete('orders');

    for (var order in orders) {
      batch.insert(
        'orders',
        {
          'id': order['id'],
          'data': jsonEncode(order),
          'timestamp': DateTime.now().millisecondsSinceEpoch,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
    await batch.commit(noResult: true);
  }

  static Future<List<Map<String, dynamic>>> getCachedOrders() async {
    final db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      'orders',
      orderBy: 'timestamp DESC',
    );

    return List.generate(maps.length, (i) {
      return jsonDecode(maps[i]['data'] as String) as Map<String, dynamic>;
    });
  }
}
