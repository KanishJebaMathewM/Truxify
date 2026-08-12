import 'dart:math';
import '../models/route_stop_model.dart';

class RouteOptimizationService {
  /// Simulates an AI-powered Traveling Salesperson Problem (TSP) optimization
  /// incorporating time windows and simulated traffic constraints.
  Future<List<RouteStop>> optimizeRoute(List<RouteStop> currentStops, double currentLat, double currentLon) async {
    // Simulate network delay for API call to routing engine
    await Future.delayed(const Duration(seconds: 2));

    if (currentStops.isEmpty) return [];

    // Clone the list to avoid mutating original data directly during calculation
    List<RouteStop> optimizedList = List.from(currentStops);

    // Basic heuristic: Sort by nearest time window first, then by distance to previous stop
    optimizedList.sort((a, b) {
      int timeCompare = a.deliveryWindowStart.compareTo(b.deliveryWindowStart);
      if (timeCompare != 0) return timeCompare;
      
      double distA = _calculateDistance(currentLat, currentLon, a.latitude, a.longitude);
      double distB = _calculateDistance(currentLat, currentLon, b.latitude, b.longitude);
      return distA.compareTo(distB);
    });

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

  // Haversine formula to calculate distance between coordinates
  double _calculateDistance(double lat1, double lon1, double lat2, double lon2) {
    const double p = 0.017453292519943295; // Math.PI / 180
    final double a = 0.5 - cos((lat2 - lat1) * p) / 2 + 
                     cos(lat1 * p) * cos(lat2 * p) * 
                     (1 - cos((lon2 - lon1) * p)) / 2;
    return 12742 * asin(sqrt(a)); // 2 * R; R = 6371 km
  }
}
