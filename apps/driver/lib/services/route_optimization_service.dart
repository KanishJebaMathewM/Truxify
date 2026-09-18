import 'dart:math';
import '../models/route_stop_model.dart';

class RouteOptimizationService {
  static const double _simulatedAverageSpeedKmh = 40.0;

  /// Simulates an AI-powered Traveling Salesperson Problem (TSP) optimization
  /// incorporating time windows and simulated traffic constraints.
  Future<List<RouteStop>> optimizeRoute(List<RouteStop> currentStops, double currentLat, double currentLon) async {
    // Simulate network delay for API call to routing engine
    await Future.delayed(const Duration(seconds: 2));

    if (currentStops.isEmpty) return [];

    final List<RouteStop> remaining = List.from(currentStops);
    final List<RouteStop> optimizedList = [];
    double referenceLat = currentLat;
    double referenceLon = currentLon;

    while (remaining.isNotEmpty) {
      final DateTime nextWindowStart = remaining
          .map((stop) => stop.deliveryWindowStart)
          .reduce((a, b) => a.isBefore(b) ? a : b);

      final sameWindowStops = remaining
          .where((stop) => stop.deliveryWindowStart == nextWindowStart)
          .toList();

      RouteStop nearest = sameWindowStops.first;
      double nearestDistance = _calculateDistance(
        referenceLat,
        referenceLon,
        nearest.latitude,
        nearest.longitude,
      );

      for (final stop in sameWindowStops.skip(1)) {
        final distance = _calculateDistance(
          referenceLat,
          referenceLon,
          stop.latitude,
          stop.longitude,
        );
        if (distance < nearestDistance) {
          nearest = stop;
          nearestDistance = distance;
        }
      }

      optimizedList.add(nearest);
      remaining.remove(nearest);
      referenceLat = nearest.latitude;
      referenceLon = nearest.longitude;
    }

    _validateDeliveryWindows(optimizedList, currentLat, currentLon);

    // Mark as optimized
    return optimizedList.map((stop) => RouteStop(
      id: stop.id,
      address: stop.address,
      latitude: stop.latitude,
      longitude: stop.longitude,
      deliveryWindowStart: stop.deliveryWindowStart,
      deliveryWindowEnd: stop.deliveryWindowEnd,
      isOptimized: true,
    )).toList();
  }

  void _validateDeliveryWindows(List<RouteStop> stops, double currentLat, double currentLon) {
    if (stops.isEmpty) return;

    DateTime currentTime = stops.first.deliveryWindowStart;
    for (final stop in stops.skip(1)) {
      if (stop.deliveryWindowStart.isBefore(currentTime)) {
        currentTime = stop.deliveryWindowStart;
      }
    }

    double previousLat = currentLat;
    double previousLon = currentLon;

    for (final stop in stops) {
      if (stop.deliveryWindowEnd.isBefore(stop.deliveryWindowStart)) {
        throw StateError(
          'Delivery window for stop ${stop.id} ends before it starts',
        );
      }

      final distanceKm = _calculateDistance(
        previousLat,
        previousLon,
        stop.latitude,
        stop.longitude,
      );
      final travelHours = distanceKm / _simulatedAverageSpeedKmh;
      final travelDuration = Duration(
        milliseconds: (travelHours * Duration.millisecondsPerHour).round(),
      );
      final arrivalTime = currentTime.add(travelDuration);
      final serviceStart = arrivalTime.isBefore(stop.deliveryWindowStart)
          ? stop.deliveryWindowStart
          : arrivalTime;

      if (serviceStart.isAfter(stop.deliveryWindowEnd)) {
        throw StateError(
          'Stop ${stop.id} cannot be reached within its delivery window',
        );
      }

      currentTime = serviceStart;
      previousLat = stop.latitude;
      previousLon = stop.longitude;
    }
  }

  // Haversine formula to calculate distance between coordinates
  double _calculateDistance(double lat1, double lon1, double lat2, double lon2) {
    const double p = 0.017453292519943295; // Math.PI / 180
    final double a = 0.5 - cos((lat2 - lat1) * p) / 2 + 
                     cos(lat1 * p) * cos(lat2 * p) * 
                     (1 - cos((lon2 - lon1) * p)) / 2;
    return 12742 * asin(sqrt(a)); // 2 * R; R = 6371 km
  }
}
