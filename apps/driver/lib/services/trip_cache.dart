import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// Caches the most recently loaded trip list locally so drivers can still
/// see delivery details, stops, and route points when the network is
/// unavailable mid-trip.
class TripCache {
  static const String _tripsKey = 'truxify_driver_cached_trips';
  static const String _stopsKey = 'truxify_driver_cached_trip_stops';
  static const String _routePointsKey = 'truxify_driver_cached_route_points';
  static const String _itemsKey = 'truxify_driver_cached_trip_items';
  static const String _savedAtKey = 'truxify_driver_cached_trips_saved_at';
  static const Duration _ttl = Duration(hours: 24);

  static Future<void> save({
    required List<Map<String, dynamic>> trips,
    required Map<String, List<Map<String, dynamic>>> stopsByTripId,
    required Map<String, List<Map<String, dynamic>>> routePointsByTripId,
    required Map<String, List<Map<String, dynamic>>> itemsByTripId,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tripsKey, jsonEncode(trips));
    await prefs.setString(_stopsKey, jsonEncode(stopsByTripId));
    await prefs.setString(_routePointsKey, jsonEncode(routePointsByTripId));
    await prefs.setString(_itemsKey, jsonEncode(itemsByTripId));
    await prefs.setString(_savedAtKey, DateTime.now().toIso8601String());
  }

  /// Returns cached trip data, or null if nothing has been cached yet.
  static Future<TripCacheSnapshot?> load() async {
    final prefs = await SharedPreferences.getInstance();
    final tripsRaw = prefs.getString(_tripsKey);
    if (tripsRaw == null) {
      return null;
    }

    try {
      final trips = List<Map<String, dynamic>>.from(
        (jsonDecode(tripsRaw) as List)
            .map((e) => Map<String, dynamic>.from(e as Map)),
      );

      final stopsRaw = prefs.getString(_stopsKey);
      final stopsByTripId = <String, List<Map<String, dynamic>>>{};
      if (stopsRaw != null) {
        final decoded = jsonDecode(stopsRaw) as Map<String, dynamic>;
        decoded.forEach((key, value) {
          stopsByTripId[key] = List<Map<String, dynamic>>.from(
            (value as List).map((e) => Map<String, dynamic>.from(e as Map)),
          );
        });
      }

      final routePointsRaw = prefs.getString(_routePointsKey);
      final routePointsByTripId = <String, List<Map<String, dynamic>>>{};
      if (routePointsRaw != null) {
        final decoded = jsonDecode(routePointsRaw) as Map<String, dynamic>;
        decoded.forEach((key, value) {
          routePointsByTripId[key] = List<Map<String, dynamic>>.from(
            (value as List).map((e) => Map<String, dynamic>.from(e as Map)),
          );
        });
      }

      final itemsRaw = prefs.getString(_itemsKey);
      final itemsByTripId = <String, List<Map<String, dynamic>>>{};

      if (itemsRaw != null) {
      final decoded = jsonDecode(itemsRaw) as Map<String, dynamic>;
      decoded.forEach((key, value) {
      itemsByTripId[key] = List<Map<String, dynamic>>.from(
      (value as List).map((e) => Map<String, dynamic>.from(e as Map)),
      );
      });
    }

      final savedAtRaw = prefs.getString(_savedAtKey);
      final savedAt = savedAtRaw != null ? DateTime.tryParse(savedAtRaw) : null;

      if (savedAt != null && DateTime.now().difference(savedAt) > _ttl) {
        return null;
      }

      return TripCacheSnapshot(
        trips: trips,
        stopsByTripId: stopsByTripId,
        routePointsByTripId: routePointsByTripId,
        itemsByTripId: itemsByTripId,
        savedAt: savedAt,
      );
    } catch (_) {
      // Corrupt or incompatible cache entry; treat as no cache available.
      return null;
    }
  }
}

class TripCacheSnapshot {
  const TripCacheSnapshot({
    required this.trips,
    required this.stopsByTripId,
    required this.routePointsByTripId,
    required this.itemsByTripId,
    required this.savedAt,
  });

  final List<Map<String, dynamic>> trips;
  final Map<String, List<Map<String, dynamic>>> stopsByTripId;
  final Map<String, List<Map<String, dynamic>>> routePointsByTripId;
  final Map<String, List<Map<String, dynamic>>> itemsByTripId;
  final DateTime? savedAt;
}
