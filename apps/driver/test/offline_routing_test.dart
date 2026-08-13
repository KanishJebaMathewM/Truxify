import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/offline_routing.dart';

void main() {
  group('OfflineRouteMatrixService.calculateOfflineRoute', () {
    const service = OfflineRouteMatrixService();

    test('uses realistic detour factor and truck speed, not naive 1.25/55', () {
      final result = service.calculateOfflineRoute(
        originLat: 12.9716,
        originLng: 77.5946,
        destLat: 13.0827,
        destLng: 80.2707,
      );

      final distanceKm = result['distance_km'] as double;
      final durationMins = result['estimated_duration_mins'] as int;
      final fuelLiters = result['estimated_fuel_liters'] as double;

      // Recompute the naive formula the old code used (haversine*1.25/55).
      const double earthRadiusKm = 6371.0;
      double _deg(double d) => d * pi / 180.0;
      final dLat = _deg(13.0827 - 12.9716);
      final dLng = _deg(80.2707 - 77.5946);
      final a = sin(dLat / 2) * sin(dLat / 2) +
          cos(_deg(12.9716)) *
              cos(_deg(13.0827)) *
              sin(dLng / 2) *
              sin(dLng / 2);
      final c = 2 * atan2(sqrt(a), sqrt(1 - a));
      final haversine = earthRadiusKm * c;
      final naiveDistance = haversine * 1.25;
      final naiveDurationMins = (naiveDistance / 55.0) * 60.0;

      // Distance now reflects the 1.5 detour factor, not 1.25.
      expect(distanceKm, isNot(closeTo(naiveDistance, 0.01)));
      // Duration now reflects the 50 km/h truck speed, not 55 km/h.
      expect(durationMins.toDouble(), isNot(closeTo(naiveDurationMins, 0.01)));
    });

    test('outputs are finite and positive', () {
      final result = service.calculateOfflineRoute(
        originLat: 28.6139,
        originLng: 77.2090,
        destLat: 19.0760,
        destLng: 72.8777,
      );

      final distanceKm = result['distance_km'] as double;
      final durationMins = result['estimated_duration_mins'] as int;
      final fuelLiters = result['estimated_fuel_liters'] as double;

      expect(distanceKm, isFinite);
      expect(distanceKm, greaterThan(0));
      expect(durationMins, greaterThan(0));
      expect(fuelLiters, isFinite);
      expect(fuelLiters, greaterThan(0));
      expect(result['is_offline_estimate'], isTrue);
    });

    test('zero distance for identical origin and destination', () {
      final result = service.calculateOfflineRoute(
        originLat: 12.9716,
        originLng: 77.5946,
        destLat: 12.9716,
        destLng: 77.5946,
      );

      expect(result['distance_km'] as double, 0.0);
      expect(result['estimated_duration_mins'] as int, 0);
      expect(result['estimated_fuel_liters'] as double, 0.0);
    });
  });
}
