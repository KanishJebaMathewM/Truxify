import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:sqflite/sqflite.dart';
import 'package:truxify/core/offline/cache/cache_manager.dart';

class MockDatabase extends Mock implements Database {}

void main() {
  late CacheManager cacheManager;
  late MockDatabase mockDatabase;

  setUp(() {
    mockDatabase = MockDatabase();
    cacheManager = CacheManager();
    cacheManager.databaseForTesting = mockDatabase;
  });

  test('getOrders with activeOnly = true does not drop older active orders when limit is reached', () async {
    final rows = <Map<String, Object?>>[];
    
    // Inactive orders (most recent, 20 of them)
    for (int i = 0; i < 20; i++) {
      rows.add({
        'id': 'inactive-$i',
        'type': 'order',
        'payload': jsonEncode({
          'id': 'inactive-$i',
          'status': 'delivered', // inactive status
        }),
        'updated_at': DateTime(2026, 8, 10).subtract(Duration(minutes: i)).toIso8601String(),
      });
    }

    // 1 Active order (oldest)
    rows.add({
      'id': 'active-oldest',
      'type': 'order',
      'payload': jsonEncode({
        'id': 'active-oldest',
        'status': 'in_transit', // active status
      }),
      'updated_at': DateTime(2026, 8, 1).toIso8601String(),
    });

    when(() => mockDatabase.rawQuery(
      any(),
      any(),
    )).thenAnswer((_) async => [
      {
        'id': 'active-oldest',
        'type': 'order',
        'payload': jsonEncode({
          'id': 'active-oldest',
          'status': 'in_transit', // active status
        }),
        'updated_at': DateTime(2026, 8, 1).toIso8601String(),
      }
    ]);

    final result = await cacheManager.getOrders(activeOnly: true, limit: 20);

    // Verify rawQuery was used to filter in SQL
    verify(() => mockDatabase.rawQuery(
      any(that: contains('WHERE status IN')),
      [20],
    )).called(1);

    expect(result.length, 1);
    expect(result.first['id'], 'active-oldest');
    expect(result.first['status'], 'in_transit');
  });
}
