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
    double distanceKm = (earthRadiusKm * c * 1.25); // Apply road winding factor
    double durationMins = (distanceKm / 55.0) * 60.0;
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
