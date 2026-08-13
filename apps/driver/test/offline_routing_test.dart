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

      // Distance reflects a corridor-aware detour factor, never the naive 1.25.
      expect(distanceKm, isNot(closeTo(naiveDistance, 0.01)));
      // Duration reflects a corridor-aware truck speed, never the flat 55 km/h.
      expect(durationMins.toDouble(), isNot(closeTo(naiveDurationMins, 0.01)));
    });

    test('uses corridor-aware detour factor and speed, not a flat model', () {
      // Short (urban) trip vs long (highway) trip.
      final short = service.calculateOfflineRoute(
        originLat: 12.9716,
        originLng: 77.5946,
        destLat: 12.9800,
        destLng: 77.6100,
      );
      final long = service.calculateOfflineRoute(
        originLat: 12.9716,
        originLng: 77.5946,
        destLat: 19.0760,
        destLng: 72.8777,
      );

      // ETA must not be the naive haversine/55 formula for either corridor.
      double _deg(double d) => d * pi / 180.0;
      double haversine(lat1, lng1, lat2, lng2) {
        final dLat = _deg(lat2 - lat1);
        final dLng = _deg(lng2 - lng1);
        final a = sin(dLat / 2) * sin(dLat / 2) +
            cos(_deg(lat1)) * cos(_deg(lat2)) * sin(dLng / 2) * sin(dLng / 2);
        return 6371.0 * (2 * atan2(sqrt(a), sqrt(1 - a)));
      }

      final shortNaive = (haversine(12.9716, 77.5946, 12.9800, 77.6100) * 1.25 / 55.0) * 60.0;
      final longNaive = (haversine(12.9716, 77.5946, 19.0760, 72.8777) * 1.25 / 55.0) * 60.0;

      expect((short['estimated_duration_mins'] as int).toDouble(),
          isNot(closeTo(shortNaive, 0.01)));
      expect((long['estimated_duration_mins'] as int).toDouble(),
          isNot(closeTo(longNaive, 0.01)));

      // Per-km effective speed differs between corridors (urban slower than
      // highway), proving the model is no longer a single flat speed.
      final shortSpeed =
          (short['distance_km'] as double) / ((short['estimated_duration_mins'] as int) / 60.0);
      final longSpeed =
          (long['distance_km'] as double) / ((long['estimated_duration_mins'] as int) / 60.0);
      expect(longSpeed, greaterThan(shortSpeed));
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
