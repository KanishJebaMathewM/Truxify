import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';

class PodRecord {
  final int? id;
  final String orderId;
  final String? signaturePath;
  final String? photoPath;
  final int synced;
  final int createdAt;
  final int retryCount;
  final int? lastRetryAt;
  final String? lastError;
  final int nextAttemptAt;
  final int generation;
  final String? uploadKey;

  PodRecord({
    this.id,
    required this.orderId,
    this.signaturePath,
    this.photoPath,
    this.synced = 0,
    required this.createdAt,
    this.retryCount = 0,
    this.lastRetryAt,
    this.lastError,
    this.nextAttemptAt = 0,
    this.generation = 0,
    this.uploadKey,
  });

  Map<String, dynamic> toMap() => {
    if (id != null) 'id': id,
    'order_id': orderId,
    'signature_path': signaturePath,
    'photo_path': photoPath,
    'synced': synced,
    'created_at': createdAt,
  };

  factory PodRecord.fromMap(Map<String, dynamic> map) => PodRecord(
    id: map['id'] as int,
    orderId: map['order_id'] as String,
    signaturePath: map['signature_path'] as String?,
    photoPath: map['photo_path'] as String?,
    synced: map['synced'] as int,
    createdAt: map['created_at'] as int,
    retryCount: map['retry_count'] as int? ?? 0,
    lastRetryAt: map['last_retry_at'] as int?,
    lastError: map['last_error'] as String?,
    nextAttemptAt: map['next_attempt_at'] as int? ?? 0,
    generation: map['generation'] as int? ?? 0,
    uploadKey: map['upload_key'] as String?,
  );
}

class PodSyncMetrics {
  final int pendingCount, retryingCount, deadLetterCount;
  final int? lastSuccess;
  const PodSyncMetrics(
    this.pendingCount,
    this.retryingCount,
    this.deadLetterCount,
    this.lastSuccess,
  );
}

class PodStorageService {
  static const schemaVersion = 3;
  static const tableName = 'pods';
  static const maxAttempts = 10;
  static const lease = Duration(minutes: 2);
  static const retryDelays = [
    Duration(minutes: 1),
    Duration(minutes: 5),
    Duration(minutes: 30),
    Duration(hours: 2),
    Duration(hours: 6),
    Duration(hours: 24),
  ];
  final Database? _providedDatabase;
  Database? _database;
  Future<Database>? _pendingInit;
  PodStorageService({Database? database}) : _providedDatabase = database;

  Future<Database> get database async {
    if (_providedDatabase != null) return _providedDatabase;
    if (_database != null) return _database!;
    _pendingInit ??= _initDB();
    try {
      return _database = await _pendingInit!;
    } finally {
      _pendingInit = null;
    }
  }

  Future<Database> _initDB() async => openDatabase(
    join(await getDatabasesPath(), 'pods_cache.db'),
    version: schemaVersion,
    onCreate: createDatabase,
    onUpgrade: upgradeDatabase,
  );

  static Future<void> createDatabase(Database db, int version) async {
    await db.execute('''CREATE TABLE pods (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL,
      signature_path TEXT, photo_path TEXT, synced INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL)''');
    await upgradeDatabase(db, 1, version);
  }

  static Future<void> upgradeDatabase(
    Database db,
    int oldVersion,
    int newVersion,
  ) async {
    if (oldVersion < 2 && newVersion >= 2) {
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_pods_synced ON pods(synced)',
      );
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_pods_order_id ON pods(order_id)',
      );
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_pods_created_at ON pods(created_at)',
      );
    }
    if (oldVersion < 3 && newVersion >= 3) {
      for (final column in [
        'retry_count INTEGER NOT NULL DEFAULT 0',
        'last_retry_at INTEGER',
        'last_error TEXT',
        'next_attempt_at INTEGER NOT NULL DEFAULT 0',
        'generation INTEGER NOT NULL DEFAULT 0',
        'lease_until INTEGER NOT NULL DEFAULT 0',
        'dead_letter INTEGER NOT NULL DEFAULT 0',
        'upload_key TEXT',
        'synced_at INTEGER',
      ]) {
        await db.execute('ALTER TABLE pods ADD COLUMN $column');
      }
      await db.execute(
        'UPDATE pods SET upload_key = lower(hex(randomblob(16)))',
      );
      await db.execute('''CREATE TABLE pod_dead_letters (
        pod_id INTEGER PRIMARY KEY, failed_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL, last_error TEXT NOT NULL)''');
      await db.execute('''CREATE INDEX idx_pods_due ON pods
        (synced, dead_letter, next_attempt_at, lease_until)''');
    }
  }

  Future<int> insertPod(PodRecord pod) async {
    final db = await database;
    return db.transaction((tx) async {
      // Never REPLACE an existing claimed row or reuse its delivery identity.
      final id = await tx.insert(tableName, pod.toMap());
      await tx.rawUpdate(
        'UPDATE pods SET upload_key = lower(hex(randomblob(16))) WHERE id = ?',
        [id],
      );
      return id;
    });
  }

  Future<List<PodRecord>> getUnsyncedPods() async =>
      (await (await database).query(
        tableName,
        where: 'synced = 0 AND dead_letter = 0',
        orderBy: 'retry_count = 0 DESC, created_at, id',
      )).map(PodRecord.fromMap).toList();

  Future<PodRecord?> getPod(int id) async {
    final rows = await (await database).query(
      tableName,
      where: 'id = ?',
      whereArgs: [id],
    );
    return rows.isEmpty ? null : PodRecord.fromMap(rows.single);
  }

  Future<PodRecord?> claimDue(int now) async {
    for (var attempt = 0; attempt < 4; attempt++) {
      try {
        return await _claimDue(now);
      } on DatabaseException catch (error) {
        final code = error.getResultCode();
        if (code == null || ![5, 6].contains(code & 255)) rethrow;
        if (attempt == 3) return null;
        // Yield outside the failed transaction so the other connection can commit.
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
    }
    return null;
  }

  Future<PodRecord?> _claimDue(int now) async => (await database).transaction((
    tx,
  ) async {
    // Recover final attempts whose process died before recording their outcome.
    final exhausted = await tx.query(
      tableName,
      where: 'synced = 0 AND dead_letter = 0 AND retry_count >= ? AND lease_until <= ?',
      whereArgs: [maxAttempts, now],
      limit: 20,
    );
    for (final row in exhausted) {
      await _deadLetter(
        tx,
        row['id'] as int,
        now,
        maxAttempts,
        'Upload lease expired after final attempt',
      );
    }
    final rows = await tx.query(
      tableName,
      where: 'synced = 0 AND dead_letter = 0 AND retry_count < 10 AND next_attempt_at <= ? AND lease_until <= ?',
      whereArgs: [now, now],
      orderBy: 'retry_count = 0 DESC, created_at, id',
      limit: 1,
    );
    if (rows.isEmpty) return null;
    final row = rows.single;
    await tx.rawUpdate(
      '''UPDATE pods SET generation = generation + 1,
      retry_count = retry_count + 1, last_retry_at = ?, lease_until = ? WHERE id = ?''',
      [now, now + lease.inMilliseconds, row['id']],
    );
    return PodRecord.fromMap(
      (await tx.query(
        tableName,
        where: 'id = ?',
        whereArgs: [row['id']],
      )).single,
    );
  }, exclusive: true);

  static String get _owned =>
      'id = ? AND generation = ? AND synced = 0 AND dead_letter = 0 AND lease_until > ?';
  static List<Object?> _owner(PodRecord pod, int now) => [
    pod.id,
    pod.generation,
    now,
  ];

  Future<bool> complete(PodRecord pod, int now) async =>
      await (await database).update(
        tableName,
        {'synced': 1, 'synced_at': now, 'lease_until': 0, 'last_error': null},
        where: _owned,
        whereArgs: _owner(pod, now),
      ) ==
      1;

  Future<bool> fail(PodRecord pod, int now, String reason) async =>
      (await database).transaction((tx) async {
        final rows = await tx.query(
          tableName,
          where: _owned,
          whereArgs: _owner(pod, now),
        );
        if (rows.isEmpty) return false;
        if (pod.retryCount >= maxAttempts) {
          await _deadLetter(tx, pod.id!, now, pod.retryCount, reason);
        } else {
          final delay =
              retryDelays[(pod.retryCount - 1).clamp(
                0,
                retryDelays.length - 1,
              )];
          await tx.update(
            tableName,
            {
              'lease_until': 0,
              'next_attempt_at': now + delay.inMilliseconds,
              'last_error': reason,
            },
            where: 'id = ?',
            whereArgs: [pod.id],
          );
        }
        return true;
      });

  Future<bool> pauseForAuth(PodRecord pod, int now) async =>
      await (await database).rawUpdate(
        '''
    UPDATE pods SET lease_until = 0, retry_count = retry_count - 1,
    next_attempt_at = ? WHERE $_owned''',
        [now + 60000, ..._owner(pod, now)],
      ) ==
      1;

  static Future<void> _deadLetter(
    Transaction tx,
    int id,
    int now,
    int attempts,
    String reason,
  ) async {
    await tx.update(
      tableName,
      {'dead_letter': 1, 'lease_until': 0, 'last_error': reason},
      where: 'id = ?',
      whereArgs: [id],
    );
    await tx.insert('pod_dead_letters', {
      'pod_id': id,
      'failed_at': now,
      'attempts': attempts,
      'last_error': reason,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<Map<String, Object?>>> deadLetters() async =>
      (await database).rawQuery(
        '''
    SELECT d.*, p.order_id FROM pod_dead_letters d JOIN pods p ON p.id = d.pod_id ORDER BY d.failed_at''',
      );

  Future<bool> requeue(int id) async => (await database).transaction((
    tx,
  ) async {
    final changed = await tx.rawUpdate(
      '''UPDATE pods SET dead_letter = 0, retry_count = 0,
      next_attempt_at = 0, lease_until = 0, last_error = NULL, generation = generation + 1
      WHERE id = ? AND dead_letter = 1 AND synced = 0''',
      [id],
    );
    if (changed == 1)
      await tx.delete('pod_dead_letters', where: 'pod_id = ?', whereArgs: [id]);
    return changed == 1;
  });

  Future<PodSyncMetrics> metrics() async {
    final row = (await (await database).rawQuery(
      '''SELECT
      COALESCE(SUM(synced = 0 AND dead_letter = 0 AND retry_count = 0), 0) AS pending,
      COALESCE(SUM(synced = 0 AND dead_letter = 0 AND retry_count > 0), 0) AS retrying,
      COALESCE(SUM(dead_letter = 1), 0) AS dead, MAX(synced_at) AS last_success FROM pods''',
    )).single;
    return PodSyncMetrics(
      row['pending'] as int,
      row['retrying'] as int,
      row['dead'] as int,
      row['last_success'] as int?,
    );
  }

  // Legacy callers may acknowledge only jobs that have never entered the runner.
  Future<int> markAsSynced(int id) async => (await database).update(
    tableName,
    {'synced': 1, 'synced_at': DateTime.now().millisecondsSinceEpoch},
    where: 'id = ? AND generation = 0 AND dead_letter = 0',
    whereArgs: [id],
  );
}

PodStorageService podStorageService = PodStorageService();
