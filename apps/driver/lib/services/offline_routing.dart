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
    // Great-circle distance is always <= real road distance. Trucks cannot
    // follow straight lines (highways, detours, restricted turns), so we apply a
    // detour/winding factor. 1.5 better approximates truck road distance than the
    // old 1.25. This is still an approximation; expect a residual error band of
    // roughly -10%..+30% versus real road distance depending on terrain/corridor.
    const double detourFactor = 1.5;
    double distanceKm = (earthRadiusKm * c * detourFactor);
    // Representative average truck speed (km/h) blending urban/highway corridors,
    // lower than the old flat 55 km/h to reflect real truck operating speeds.
    const double avgTruckSpeedKmh = 50.0;
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
