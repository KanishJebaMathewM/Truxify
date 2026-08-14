import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truxify_driver/services/trip_cache.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  final trips = <Map<String, dynamic>>[
    {'trip_display_id': 'trip-1', 'status': 'completed'},
    {'trip_display_id': 'trip-2', 'status': 'in_progress'},
  ];
  final stopsByTripId = <String, List<Map<String, dynamic>>>{
    'trip-1': [
      {'stop_id': 'stop-1'},
    ],
  };
  final routePointsByTripId = <String, List<Map<String, dynamic>>>{
    'trip-1': [
      {'lat': 19.076, 'lng': 72.877},
    ],
  };
  final itemsByTripId = <String, List<Map<String, dynamic>>>{
    'trip-1': [
      {'item_id': 'item-1'},
    ],
  };

  group('TripCache.save/load', () {
    test('save writes JSON and load returns it unchanged', () async {
      await TripCache.save(
        trips: trips,
        stopsByTripId: stopsByTripId,
        routePointsByTripId: routePointsByTripId,
        itemsByTripId: itemsByTripId,
      );

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('truxify_driver_cached_trips'), jsonEncode(trips));
      expect(
        prefs.getString('truxify_driver_cached_trip_stops'),
        jsonEncode(stopsByTripId),
      );
      expect(
        prefs.getString('truxify_driver_cached_route_points'),
        jsonEncode(routePointsByTripId),
      );
      expect(
        prefs.getString('truxify_driver_cached_trip_items'),
        jsonEncode(itemsByTripId),
      );
      expect(prefs.getString('truxify_driver_cached_trips_saved_at'), isNotNull);

      final snapshot = await TripCache.load();
      expect(snapshot, isNotNull);
      expect(snapshot!.trips, trips);
      expect(snapshot.stopsByTripId, stopsByTripId);
      expect(snapshot.routePointsByTripId, routePointsByTripId);
      expect(snapshot.itemsByTripId, itemsByTripId);
      expect(snapshot.savedAt, isNotNull);
    });

    test('load returns null when nothing is cached', () async {
      final snapshot = await TripCache.load();
      expect(snapshot, isNull);
    });

    test('load handles corrupt trips JSON gracefully', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'truxify_driver_cached_trips': 'not valid json',
      });

      final snapshot = await TripCache.load();
      expect(snapshot, isNull);
    });

    test('load handles non-list trips JSON gracefully', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'truxify_driver_cached_trips': '{"not": "a list"}',
      });

      final snapshot = await TripCache.load();
      expect(snapshot, isNull);
    });

    test('load handles corrupt section JSON gracefully', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'truxify_driver_cached_trips': jsonEncode(trips),
        'truxify_driver_cached_trip_stops': 'not valid json',
      });

      final snapshot = await TripCache.load();
      expect(snapshot, isNotNull);
      expect(snapshot!.trips, trips);
      expect(snapshot.stopsByTripId, isEmpty);
    });

    test('load clears expired cache', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'truxify_driver_cached_trips': jsonEncode(trips),
        'truxify_driver_cached_trips_saved_at':
            DateTime.now().subtract(const Duration(hours: 25)).toIso8601String(),
      });

      final snapshot = await TripCache.load();
      expect(snapshot, isNull);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('truxify_driver_cached_trips'), isNull);
    });
  });
}
