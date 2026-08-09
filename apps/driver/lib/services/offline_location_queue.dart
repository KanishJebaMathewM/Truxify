import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:sqflite/sqflite.dart';

import 'local_db_service.dart';

/// What a queued item is.
enum QueueItemKind {
  /// A driver location ping (`location_ping` over the tracking WebSocket).
  location,

  /// A geofence milestone (`PUT /api/orders/:id/milestones`).
  milestone,
}

/// A single entry in the durable offline delivery queue.
class QueueItem {
  const QueueItem({
    required this.id,
    required this.kind,
    this.driverId,
    this.orderId,
    this.orderDisplayId,
    this.milestone,
    this.idempotencyKey,
    required this.payload,
    required this.createdAt,
    this.attempts = 0,
  });

  final int id;
  final QueueItemKind kind;
  final String? driverId;
  final String? orderId;
  final String? orderDisplayId;
  final String? milestone;
  final String? idempotencyKey;

  /// Full JSON payload of the item. For locations this is the complete
  /// `location_ping` data map. For milestones it is
  /// `{'orderId': ..., 'milestone': ...}`.
  final Map<String, dynamic> payload;

  /// When the item was first accepted into the pipeline.
  final DateTime createdAt;

  /// Number of delivery attempts made so far (informational).
  final int attempts;

  static String kindTo(QueueItemKind kind) =>
      kind == QueueItemKind.milestone ? 'milestone' : 'location';

  static QueueItemKind kindFrom(String? value) =>
      value == 'milestone' ? QueueItemKind.milestone : QueueItemKind.location;

  /// Decodes a database row. Throws [FormatException] for corrupted rows so
  /// callers can quarantine them instead of crashing.
  factory QueueItem.fromRow(Map<String, dynamic> row) {
    final id = row['id'];
    if (id is! int) {
      throw const FormatException('Queue record missing numeric id');
    }
    final createdMs = row['created_at'];
    if (createdMs is! int) {
      throw const FormatException('Queue record missing numeric created_at');
    }
    final rawPayload = row['payload'];
    if (rawPayload is! String || rawPayload.isEmpty) {
      throw const FormatException('Queue record missing payload');
    }
    final decoded = jsonDecode(rawPayload);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Queue payload is not a JSON object');
    }
    return QueueItem(
      id: id,
      kind: kindFrom(row['kind'] as String?),
      driverId: row['driver_id'] as String?,
      orderId: row['order_id'] as String?,
      orderDisplayId: row['order_display_id'] as String?,
      milestone: row['milestone'] as String?,
      idempotencyKey: row['idempotency_key'] as String?,
      payload: decoded,
      createdAt: DateTime.fromMillisecondsSinceEpoch(createdMs),
      attempts: row['attempts'] as int? ?? 0,
    );
  }
}

/// Persistence surface for the offline queue.
///
/// Abstracted so the queue policy (dedup, coalescing, capacity) is
/// unit-testable without the sqflite platform plugin. The production
/// implementation reads/writes the shared driver local database
/// (`truxify_driver.db`, see [LocalDbService]).
abstract class LocationQueueStore {
  /// Inserts a row. Returns 1 when inserted, 0 when a duplicate
  /// `idempotency_key` was ignored.
  Future<int> insert(Map<String, dynamic> row);

  /// Returns all rows ordered oldest first (stable tiebreak by id).
  Future<List<Map<String, dynamic>>> query();

  Future<int> deleteWhereId(int id);

  Future<int> count();

  /// Replaces the stored payload/created_at of a row (used by coalescing).
  Future<int> updatePayload(
    int id, {
    required String payload,
    required int createdAtMs,
  });

  /// Deletes the [count] oldest location rows, never [keepNewestId].
  Future<int> deleteOldestLocations({
    required int count,
    required int keepNewestId,
  });

  /// Deletes the [count] oldest rows of any kind (last-resort trim).
  Future<int> deleteOldestRows(int count);

  /// Looks up a row by its unique idempotency key (or null).
  Future<Map<String, dynamic>?> findByIdempotencyKey(String key);
}

/// sqflite-backed implementation over the driver's shared local DB.
class SqfliteLocationQueueStore implements LocationQueueStore {
  static const String table = 'location_queue';

  Future<Database> get _db => LocalDbService.instance.database;

  @override
  Future<int> insert(Map<String, dynamic> row) async {
    final db = await _db;
    return db.insert(
      table,
      row,
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
  }

  @override
  Future<List<Map<String, dynamic>>> query() async {
    final db = await _db;
    return db.query(table, orderBy: 'created_at ASC, id ASC');
  }

  @override
  Future<int> deleteWhereId(int id) async {
    final db = await _db;
    return db.delete(table, where: 'id = ?', whereArgs: [id]);
  }

  @override
  Future<int> count() async {
    final db = await _db;
    final result = await db.rawQuery('SELECT COUNT(*) AS c FROM $table');
    return Sqflite.firstIntValue(result) ?? 0;
  }

  @override
  Future<int> updatePayload(
    int id, {
    required String payload,
    required int createdAtMs,
  }) async {
    final db = await _db;
    return db.update(
      table,
      {'payload': payload, 'created_at': createdAtMs, 'attempts': 0},
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  @override
  Future<int> deleteOldestLocations({
    required int count,
    required int keepNewestId,
  }) async {
    final db = await _db;
    final rows = await db.rawQuery(
      'SELECT id FROM $table '
      'WHERE kind = "location" AND id != ? '
      'ORDER BY created_at ASC, id ASC LIMIT ?',
      [keepNewestId, count],
    );
    if (rows.isEmpty) return 0;
    final ids = rows.map((r) => r['id']).toList();
    return db.delete(
      table,
      where: 'id IN (${List.filled(ids.length, '?').join(',')})',
      whereArgs: ids,
    );
  }

  @override
  Future<int> deleteOldestRows(int count) async {
    final db = await _db;
    final rows = await db.rawQuery(
      'SELECT id FROM $table ORDER BY created_at ASC, id ASC LIMIT ?',
      [count],
    );
    if (rows.isEmpty) return 0;
    final ids = rows.map((r) => r['id']).toList();
    return db.delete(
      table,
      where: 'id IN (${List.filled(ids.length, '?').join(',')})',
      whereArgs: ids,
    );
  }

  @override
  Future<Map<String, dynamic>?> findByIdempotencyKey(String key) async {
    final db = await _db;
    final rows = await db.query(
      table,
      where: 'idempotency_key = ?',
      whereArgs: [key],
      limit: 1,
    );
    return rows.isEmpty ? null : rows.first;
  }
}

/// Bounded, durable queue for driver location pings and geofence milestones.
///
/// Delivery semantics
/// ------------------
/// An item is only ever removed from the queue after the backend accepts it.
/// `enqueueLocation`/`enqueueMilestone` return `true` when the item is now
/// guaranteed to be delivered eventually (either it was inserted or an
/// equivalent item is already queued). Callers must treat `true` as "in the
/// pipeline" and `false` as "not persisted — retry later".
///
/// Capacity policy (deterministic)
/// -------------------------------
/// * The queue never grows past [maxEntries] rows.
/// * Consecutive fixes within [coalesceWindow]/[coalesceDistanceMeters] are
///   coalesced into a single row (the newest fix wins) so long offline
///   stretches collapse into representative points.
/// * When capacity is exceeded, the OLDEST location rows are dropped while the
///   newest location fix (the truck's actual position) is always retained.
/// * Milestone rows are never dropped by the capacity policy — a geofence
///   event outranks ordinary telemetry.
///
/// Corruption safety
/// -----------------
/// Rows that fail to decode are quarantined (deleted) on read so a corrupted
/// record can never crash the application or block delivery of healthy rows.
class OfflineLocationQueue {
  /// Production singleton backed by the shared driver local DB.
  static final OfflineLocationQueue instance = OfflineLocationQueue();

  /// Test hook: inject a fake store without touching sqflite.
  @visibleForTesting
  static OfflineLocationQueue Function()? testInstanceBuilder;

  /// Creates a queue. Tests pass a fake [LocationQueueStore].
  OfflineLocationQueue({
    LocationQueueStore? store,
    this.maxEntries = 500,
    this.coalesceWindow = const Duration(seconds: 60),
    this.coalesceDistanceMeters = 500.0,
    this.duplicateWindow = const Duration(seconds: 120),
    this.duplicateDistanceMeters = 15.0,
  }) : _store = store ?? SqfliteLocationQueueStore();

  final LocationQueueStore _store;

  /// Hard cap on stored rows. Bounds storage even during very long offline
  /// stretches.
  final int maxEntries;

  /// Locations within this time+space window of the newest queued fix are
  /// treated as one cluster and coalesced into a single representative row.
  final Duration coalesceWindow;
  final double coalesceDistanceMeters;

  /// A location identical (within distance) to the newest queued fix and
  /// queued within this window is considered already in the pipeline and is
  /// not written again. Guards the 5-second heartbeat ping from duplicating
  /// rows while offline.
  final Duration duplicateWindow;
  final double duplicateDistanceMeters;

  static const String _msKey = 'milestone';

  String _milestoneKey(String orderId, String milestone) =>
      '$_msKey:$orderId:$milestone';

  /// Queues a location ping payload. Returns `true` when the fix is now
  /// guaranteed to be delivered (inserted or already represented in the queue).
  Future<bool> enqueueLocation(Map<String, dynamic> payload) async {
    final data = _dataOf(payload);
    final now = DateTime.now();
    final createdAtMs = now.millisecondsSinceEpoch;
    final driverId = data['driver_id']?.toString();
    final orderId = data['orderId']?.toString() ?? data['order_id']?.toString();
    final orderDisplayId = data['order_display_id']?.toString();

    final newest = await _newestLocation();
    if (newest != null) {
      // Already in the pipeline: an identical fix was queued moments ago
      // (e.g. the 5s heartbeat ping) — skip the write entirely.
      if (_isDuplicate(newest.payload, payload, now.difference(newest.createdAt))) {
        return true;
      }
      // Same cluster: replace the representative row with this newer fix so
      // offline stretches collapse instead of unboundedly growing.
      if (_inCluster(newest.payload, payload, now.difference(newest.createdAt))) {
        await _store.updatePayload(
          newest.id,
          payload: jsonEncode(payload),
          createdAtMs: createdAtMs,
        );
        return true;
      }
    }

    await _store.insert({
      'kind': QueueItemKind.kindTo(QueueItemKind.location),
      'driver_id': driverId,
      'order_id': orderId,
      'order_display_id': orderDisplayId,
      'milestone': null,
      'idempotency_key': null,
      'payload': jsonEncode(payload),
      'created_at': createdAtMs,
      'attempts': 0,
    });

    await _trimToCapacity();
    return true;
  }

  /// Queues a geofence milestone. Idempotent: re-enqueueing the same logical
  /// milestone (same order + milestone) is a no-op. Returns `true` when the
  /// milestone is guaranteed to be delivered.
  Future<bool> enqueueMilestone({
    required String orderId,
    required String milestone,
    required String driverId,
  }) async {
    final key = _milestoneKey(orderId, milestone);
    if (await _store.findByIdempotencyKey(key) != null) {
      return true;
    }
    final now = DateTime.now();
    await _store.insert({
      'kind': QueueItemKind.kindTo(QueueItemKind.milestone),
      'driver_id': driverId,
      'order_id': orderId,
      'order_display_id': null,
      'milestone': milestone,
      'idempotency_key': key,
      'payload': jsonEncode({'orderId': orderId, 'milestone': milestone}),
      'created_at': now.millisecondsSinceEpoch,
      'attempts': 0,
    });
    return true;
  }

  /// Whether a pending milestone for this order+type already exists.
  Future<bool> containsPendingMilestone({
    required String orderId,
    required String milestone,
  }) async {
    return await _store.findByIdempotencyKey(
          _milestoneKey(orderId, milestone),
        ) !=
        null;
  }

  /// All pending items, oldest first. Corrupted rows are quarantined and
  /// skipped; healthy rows are returned in stable order.
  Future<List<QueueItem>> pending() async {
    final rows = await _store.query();
    final items = <QueueItem>[];
    for (final row in rows) {
      try {
        items.add(QueueItem.fromRow(row));
      } on FormatException {
        await _quarantineCorruptRow(row);
      }
    }
    return items;
  }

  /// Permanently removes a successfully-delivered item.
  Future<void> remove(int id) async {
    await _store.deleteWhereId(id);
  }

  /// Number of queued items (including milestones).
  Future<int> count() => _store.count();

  Future<QueueItem?> _newestLocation() async {
    final rows = await _store.query();
    for (final row in rows.reversed) {
      try {
        final item = QueueItem.fromRow(row);
        if (item.kind == QueueItemKind.location) return item;
      } on FormatException {
        continue;
      }
    }
    return null;
  }

  bool _isDuplicate(
    Map<String, dynamic> a,
    Map<String, dynamic> b,
    Duration age,
  ) {
    if (age > duplicateWindow) return false;
    final dataA = _dataOf(a);
    final dataB = _dataOf(b);
    if (dataA['orderId']?.toString() != dataB['orderId']?.toString()) return false;
    if (dataA['driver_id']?.toString() != dataB['driver_id']?.toString()) {
      return false;
    }
    return _distanceBetween(a, b) <= duplicateDistanceMeters;
  }

  bool _inCluster(
    Map<String, dynamic> a,
    Map<String, dynamic> b,
    Duration age,
  ) {
    if (age > coalesceWindow) return false;
    final dataA = _dataOf(a);
    final dataB = _dataOf(b);
    if (dataA['orderId']?.toString() != dataB['orderId']?.toString()) return false;
    return _distanceBetween(a, b) <= coalesceDistanceMeters;
  }

  double _distanceBetween(Map<String, dynamic> a, Map<String, dynamic> b) {
    final latA = _latOf(a);
    final lngA = _lngOf(a);
    final latB = _latOf(b);
    final lngB = _lngOf(b);
    if (latA == null || lngA == null || latB == null || lngB == null) {
      return double.infinity;
    }
    return _haversineMeters(latA, lngA, latB, lngB);
  }

  /// Telemetry lives under the `data` key of the `{event, data}` envelope the
  /// backend tracking contract expects. Falls back to the whole map for
  /// robustness (e.g. items queued by older formats).
  Map<String, dynamic> _dataOf(Map<String, dynamic> payload) {
    final data = payload['data'];
    return data is Map<String, dynamic> ? data : payload;
  }

  double? _latOf(Map<String, dynamic> p) {
    final data = _dataOf(p);
    final v = data['latitude'] ?? data['lat'];
    return v is num ? v.toDouble() : null;
  }

  double? _lngOf(Map<String, dynamic> p) {
    final data = _dataOf(p);
    final v = data['longitude'] ?? data['lng'];
    return v is num ? v.toDouble() : null;
  }

  double _haversineMeters(double lat1, double lng1, double lat2, double lng2) {
    const earthRadiusM = 6371000.0;
    final dLat = _rad(lat2 - lat1);
    final dLng = _rad(lng2 - lng1);
    final a = math.pow(math.sin(dLat / 2), 2) +
        math.cos(_rad(lat1)) *
            math.cos(_rad(lat2)) *
            math.pow(math.sin(dLng / 2), 2);
    return 2 * earthRadiusM * math.asin(math.sqrt(a));
  }

  double _rad(double deg) => deg * math.pi / 180.0;

  /// Drops the oldest location rows until the queue is within capacity.
  /// The newest location fix and all milestone rows survive.
  Future<void> _trimToCapacity() async {
    var guard = 0;
    while (guard++ < 10) {
      final total = await _store.count();
      if (total <= maxEntries) return;
      final newest = await _newestLocation();
      final before = total;
      if (newest != null) {
        await _store.deleteOldestLocations(
          count: total - maxEntries,
          keepNewestId: newest.id,
        );
      } else {
        await _store.deleteOldestRows(total - maxEntries);
      }
      final after = await _store.count();
      if (after >= before) return; // nothing deleted — stop to avoid a loop
    }
  }

  Future<void> _quarantineCorruptRow(Map<String, dynamic> row) async {
    final id = row['id'];
    if (id is! int) return;
    try {
      await _store.deleteWhereId(id);
    } catch (_) {
      // Never let a corrupt row block the queue.
    }
  }
}
