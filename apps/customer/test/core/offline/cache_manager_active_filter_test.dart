import 'package:flutter_test/flutter_test.dart';

import 'package:truxify/core/offline/cache/cache_manager.dart';

void main() {
  Map<String, dynamic> order(String id, String status) =>
      {'id': id, 'status': status, '_cached_at': '$status-$id'};

  group('CacheManager.filterActiveOrders (issue #7739)', () {
    test('returns an active order that sits below 20 recently-updated inactive ones', () {
      final rows = [
        for (var i = 0; i < 20; i++) order('inactive-$i', 'delivered'),
        order('active-1', 'in_transit'),
      ];

      final result = CacheManager.filterActiveOrders(rows, limit: 20);

      expect(result.map((o) => o['id']).toList(), contains('active-1'));
    });

    test('truncates to the limit only after filtering', () {
      final rows = [
        order('a', 'in_transit'),
        order('b', 'in_transit'),
        order('c', 'in_transit'),
        order('d', 'delivered'),
      ];

      final result = CacheManager.filterActiveOrders(rows, limit: 2);

      expect(result.map((o) => o['id']).toList(), ['a', 'b']);
    });

    test('drops terminal statuses entirely', () {
      final rows = [
        order('x', 'cancelled'),
        order('y', 'refunded'),
        order('z', 'active'),
      ];

      final result = CacheManager.filterActiveOrders(rows, limit: 20);

      expect(result.map((o) => o['id']).toList(), ['z']);
    });

    test('keeps the most recently updated active orders within the limit', () {
      final rows = [
        order('newest', 'picked_up'),
        order('older', 'arriving'),
        order('oldest', 'active'),
      ];

      final result = CacheManager.filterActiveOrders(rows, limit: 2);

      expect(result.map((o) => o['id']).toList(), ['newest', 'older']);
    });
  });
}
