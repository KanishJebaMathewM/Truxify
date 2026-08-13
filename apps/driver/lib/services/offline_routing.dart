import 'dart:convert';
import 'dart:math';

/// Offline Route Matrix computation service for Flutter Driver App.
/// Uses WASM pre-computed math fallback when device is offline.
class OfflineRouteMatrixService {
  static final OfflineRouteMatrixService _instance = OfflineRouteMatrixService._internal();

  factory OfflineRouteMatrixService() => _instance;

  OfflineRouteMatrixService._internal();

  /// Calculates offline distance, duration, and fuel consumption for truck routes.
  Map<String, dynamic> calculateOfflineRoute({
    required double originLat,
    required double originLng,
    required double destLat,
    required double destLng,
  }) {
    const double earthRadiusKm = 6371.0;

    double dLat = _degreesToRadians(destLat - originLat);
    double dLng = _degreesToRadians(destLng - originLng);

    double a = sin(dLat / 2) * sin(dLat / 2) +
        cos(_degreesToRadians(originLat)) *
            cos(_degreesToRadians(destLat)) *
            sin(dLng / 2) *
            sin(dLng / 2);

    double c = 2 * atan2(sqrt(a), sqrt(1 - a));
    double greatCircleKm = earthRadiusKm * c;

    // Great-circle distance is always <= real road distance. Trucks cannot
    // follow straight lines, so we estimate a drivable road distance using a
    // corridor-aware detour factor instead of a flat multiplier: short trips are
    // intra-urban (more winding), long trips use highways (less winding).
    // This is still an approximation; expect a residual error band of
    // roughly -10%..+30% versus real road distance depending on terrain/corridor.
    double detourFactor;
    if (greatCircleKm < 10) {
      detourFactor = 1.6;
    } else if (greatCircleKm < 50) {
      detourFactor = 1.4;
    } else {
      detourFactor = 1.2;
    }
    double distanceKm = (greatCircleKm * detourFactor);
    // Use a corridor-aware truck speed (km/h) instead of a flat constant: urban
    // corridors are slower and highway corridors are faster, reflecting posted
    // truck speed limits rather than a single assumed value.
    double avgTruckSpeedKmh;
    if (greatCircleKm < 10) {
      avgTruckSpeedKmh = 35.0;
    } else if (greatCircleKm < 50) {
      avgTruckSpeedKmh = 45.0;
    } else {
      avgTruckSpeedKmh = 65.0;
    }
    double durationMins = (distanceKm / avgTruckSpeedKmh) * 60.0;
    double fuelLiters = distanceKm * 0.32;

    return {
      'distance_km': double.parse(distanceKm.toStringAsFixed(2)),
      'estimated_duration_mins': durationMins.round(),
      'estimated_fuel_liters': double.parse(fuelLiters.toStringAsFixed(2)),
      'is_offline_estimate': true,
    };
  }

  double _degreesToRadians(double degrees) {
    return degrees * pi / 180.0;
  }
}
