import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/offline_location_queue.dart';

/// In-memory [LocationQueueStore] mirroring the sqflite row semantics so the
/// queue policy is testable without the sqflite platform plugin.
class FakeLocationQueueStore implements LocationQueueStore {
  FakeLocationQueueStore({this.maxId = 0});

  int maxId;
  final List<Map<String, dynamic>> rows = [];

  @override
  Future<int> insert(Map<String, dynamic> row) async {
    final key = row['idempotency_key'];
    if (key != null && rows.any((r) => r['idempotency_key'] == key)) {
      return 0; // UNIQUE conflict ignored.
    }
    maxId += 1;
    rows.add({...row, 'id': maxId});
    return 1;
  }

  @override
  Future<List<Map<String, dynamic>>> query() async {
    final sorted = [...rows]
      ..sort((a, b) {
        final byTime = (a['created_at'] as int).compareTo(b['created_at'] as int);
        if (byTime != 0) return byTime;
        return (a['id'] as int).compareTo(b['id'] as int);
      });
    return sorted;
  }

  @override
  Future<int> deleteWhereId(int id) async {
    final before = rows.length;
    rows.removeWhere((r) => r['id'] == id);
    return before - rows.length;
  }

  @override
  Future<int> count() async => rows.length;

  @override
  Future<int> updatePayload(
    int id, {
    required String payload,
    required int createdAtMs,
  }) async {
    for (final row in rows) {
      if (row['id'] == id) {
        row['payload'] = payload;
        row['created_at'] = createdAtMs;
        row['attempts'] = 0;
        return 1;
      }
    }
    return 0;
  }

  @override
  Future<int> deleteOldestLocations({
    required int count,
    required int keepNewestId,
  }) async {
    final candidates = rows
        .where((r) => r['kind'] == 'location' && r['id'] != keepNewestId)
        .toList()
      ..sort((a, b) {
        final byTime = (a['created_at'] as int).compareTo(b['created_at'] as int);
        if (byTime != 0) return byTime;
        return (a['id'] as int).compareTo(b['id'] as int);
      });
    final doomed = candidates.take(count).map((r) => r['id']).toSet();
    final before = rows.length;
    rows.removeWhere((r) => doomed.contains(r['id']));
    return before - rows.length;
  }

  @override
  Future<int> deleteOldestRows(int count) async {
    final sorted = [...rows]
      ..sort((a, b) {
        final byTime = (a['created_at'] as int).compareTo(b['created_at'] as int);
        if (byTime != 0) return byTime;
        return (a['id'] as int).compareTo(b['id'] as int);
      });
    final doomed = sorted.take(count).map((r) => r['id']).toSet();
    final before = rows.length;
    rows.removeWhere((r) => doomed.contains(r['id']));
    return before - rows.length;
  }

  @override
  Future<Map<String, dynamic>?> findByIdempotencyKey(String key) async {
    for (final row in rows) {
      if (row['idempotency_key'] == key) return row;
    }
    return null;
  }
}

Map<String, dynamic> loc({
  double lat = 20.0,
  double lng = 70.0,
  String driverId = 'driver-1',
  String orderId = 'order-1',
}) {
  return {
    'event': 'location_ping',
    'data': {
      'driver_id': driverId,
      'driverId': driverId,
      'orderId': orderId,
      'order_display_id': 'OD-1',
      'lat': lat,
      'lng': lng,
      'latitude': lat,
      'longitude': lng,
      'speed': 0,
      'bearing': 0,
      'device_timestamp': DateTime.now().toIso8601String(),
      'timestamp': DateTime.now().toIso8601String(),
    },
  };
}

Map<String, dynamic> dataOf(Map<String, dynamic> payload) =>
    payload['data'] is Map<String, dynamic>
        ? payload['data'] as Map<String, dynamic>
        : payload;

void main() {
  late FakeLocationQueueStore store;
  late OfflineLocationQueue queue;

  setUp(() {
    store = FakeLocationQueueStore();
    queue = OfflineLocationQueue(
      store: store,
      maxEntries: 10,
      duplicateWindow: const Duration(seconds: 120),
      duplicateDistanceMeters: 15.0,
      coalesceWindow: const Duration(seconds: 60),
      coalesceDistanceMeters: 500.0,
    );
  });

  group('OfflineLocationQueue persistence', () {
    test('enqueued location survives a "restart" (new queue over same store)', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));

      // Simulate app restart: a brand-new queue instance over the same store.
      final restarted = OfflineLocationQueue(store: store);
      final pending = await restarted.pending();

      expect(pending, hasLength(1));
      expect(dataOf(pending.first.payload)['lat'], 21.0);
      expect(dataOf(pending.first.payload)['lng'], 72.0);
      expect(pending.first.kind, QueueItemKind.location);
    });

    test('pending() returns items oldest first', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      await queue.enqueueLocation(loc(lat: 21.01, lng: 72.01));
      await queue.enqueueLocation(loc(lat: 21.02, lng: 72.02));

      final pending = await queue.pending();
      expect(pending, hasLength(3));
      expect(pending[0].payload['data']['lat'], 21.0);
      expect(pending[1].payload['data']['lat'], 21.01);
      expect(pending[2].payload['data']['lat'], 21.02);
    });

    test('remove() deletes only the target row', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      await queue.enqueueLocation(loc(lat: 21.01, lng: 72.01));
      final pending = await queue.pending();
      await queue.remove(pending.first.id);

      final remaining = await queue.pending();
      expect(remaining, hasLength(1));
      expect(remaining.first.payload['data']['lat'], 21.01);
    });
  });

  group('OfflineLocationQueue dedup & coalescing', () {
    test('identical position within window is not written again', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      final ok = await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      expect(ok, isTrue, reason: 'an equivalent fix is already in the pipeline');
      expect(await queue.count(), 1);
    });

    test('near-identical position within duplicate distance is deduped', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      // ~7m north — inside the 15m duplicate window.
      await queue.enqueueLocation(loc(lat: 21.0001, lng: 72.0));
      expect(await queue.count(), 1);
    });

    test('movement beyond duplicate window creates a new entry', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      // ~2.2 km away — new entry.
      await queue.enqueueLocation(loc(lat: 21.02, lng: 72.0));
      expect(await queue.count(), 2);
    });

    test('cluster coalescing replaces the representative with the newest fix', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      // ~220m away — same cluster, coalesced.
      await queue.enqueueLocation(loc(lat: 21.002, lng: 72.0));
      expect(await queue.count(), 1);
      final pending = await queue.pending();
      expect(pending.single.payload['data']['lat'], 21.002,
          reason: 'the newest fix in the cluster must win');
    });
  });

  group('OfflineLocationQueue capacity policy', () {
    test('queue is bounded and retains the newest location + all milestones', () async {
      // Fill past capacity: 15 distinct locations.
      for (var i = 0; i < 15; i++) {
        await queue.enqueueLocation(loc(lat: 21.0 + i * 0.01, lng: 72.0));
      }
      // Add two milestones (priority: never dropped).
      await queue.enqueueMilestone(
        orderId: 'order-1',
        milestone: 'Arrived at Pickup',
        driverId: 'driver-1',
      );
      await queue.enqueueMilestone(
        orderId: 'order-1',
        milestone: 'Arriving',
        driverId: 'driver-1',
      );

      final total = await queue.count();
      expect(total, lessThanOrEqualTo(10 + 2),
          reason: 'milestones are never dropped by the capacity policy');

      final pending = await queue.pending();
      final locations =
          pending.where((i) => i.kind == QueueItemKind.location).toList();
      final milestones =
          pending.where((i) => i.kind == QueueItemKind.milestone).toList();

      expect(milestones, hasLength(2));
      expect(locations, hasLength(10));
      // The newest location fix is always retained.
      expect(locations.last.payload['data']['lat'], 21.0 + 14 * 0.01);
      // Oldest location was dropped first.
      expect(locations.first.payload['data']['lat'], isNot(21.0));
    });
  });

  group('OfflineLocationQueue milestones', () {
    test('same logical milestone is only queued once (stable idempotency key)', () async {
      await queue.enqueueMilestone(
        orderId: 'order-1',
        milestone: 'Arrived at Pickup',
        driverId: 'driver-1',
      );
      await queue.enqueueMilestone(
        orderId: 'order-1',
        milestone: 'Arrived at Pickup',
        driverId: 'driver-1',
      );
      await queue.enqueueMilestone(
        orderId: 'order-1',
        milestone: 'Arriving',
        driverId: 'driver-1',
      );

      expect(await queue.count(), 2);
      expect(
        await queue.containsPendingMilestone(
          orderId: 'order-1',
          milestone: 'Arrived at Pickup',
        ),
        isTrue,
      );
    });
  });

  group('OfflineLocationQueue corruption safety', () {
    test('corrupted row is quarantined and healthy rows remain usable', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      store.rows.add({
        'id': store.maxId + 1,
        'kind': 'location',
        'driver_id': 'driver-1',
        'order_id': 'order-1',
        'order_display_id': null,
        'milestone': null,
        'idempotency_key': null,
        'payload': '{not valid json',
        'created_at': DateTime.now().millisecondsSinceEpoch,
        'attempts': 0,
      });
      store.rows.add({
        'id': store.maxId + 2,
        'kind': 'milestone',
        'driver_id': 'driver-1',
        'order_id': 'order-1',
        'order_display_id': null,
        'milestone': 'Arriving',
        'idempotency_key': 'milestone:order-1:Arriving',
        'payload': jsonEncode({'orderId': 'order-1', 'milestone': 'Arriving'}),
        'created_at': DateTime.now().millisecondsSinceEpoch,
        'attempts': 0,
      });

      final pending = await queue.pending();
      // Corrupt row was dropped; the two healthy rows are intact.
      expect(pending, hasLength(2));
      expect(
        pending.every((i) {
          final data = i.payload['data'];
          return (data is Map && data['lat'] != null) || i.milestone != null;
        }),
        isTrue,
      );
      expect(store.rows, hasLength(2), reason: 'corrupt row was quarantined');
    });

    test('pending() with all-corrupt rows does not throw', () async {
      store.rows.add({
        'id': 1,
        'kind': 'location',
        'driver_id': null,
        'order_id': null,
        'order_display_id': null,
        'milestone': null,
        'idempotency_key': null,
        'payload': '###',
        'created_at': 1,
        'attempts': 0,
      });
      expect(await queue.pending(), isEmpty);
    });
  });
}
