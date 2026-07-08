import 'dart:convert';
import 'dart:math' as math;

import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

class RouteInfo {
  final List<LatLng> points;
  final double distanceKm;
  final double durationMin;
  RouteInfo({required this.points, required this.distanceKm, required this.durationMin});
}

class RouteService {
  static Future<List<LatLng>> fetchRouteGeoJson(List<LatLng> points) async {
    final info = await fetchRouteInfo(points);
    return info?.points ?? [];
  }

  /// Fetch a driving route from OSRM between the given [points].
  /// Returns route info with distance and duration.
  static Future<RouteInfo?> fetchRouteInfo(List<LatLng> points) async {
    if (points.length < 2) return null;
    final coords = points.map((p) => '${p.longitude},${p.latitude}').join(';');
    final url = Uri.parse('https://router.project-osrm.org/route/v1/driving/$coords?overview=full&geometries=geojson&alternatives=true');
    try {
      final resp = await http.get(url).timeout(const Duration(seconds: 8));
      if (resp.statusCode != 200) return null;

      final decoded = json.decode(resp.body);
      if (decoded is! Map<String, dynamic>) return null;

      final routes = decoded['routes'];
      if (routes is! List || routes.isEmpty) return null;

      final firstRoute = routes.first;
      if (firstRoute is! Map<String, dynamic>) return null;

      final distance = (firstRoute['distance'] as num?)?.toDouble() ?? 0;
      final duration = (firstRoute['duration'] as num?)?.toDouble() ?? 0;

      final geometry = firstRoute['geometry'];
      if (geometry is! Map<String, dynamic>) return null;

      final coordsList = geometry['coordinates'];
      if (coordsList is! List) return [];

      final out = <LatLng>[];
      for (final e in coordsList) {
        if (e is List && e.length >= 2) {
          final lon = (e[0] as num).toDouble();
          final lat = (e[1] as num).toDouble();
          out.add(LatLng(lat, lon));
        }
      }
      return RouteInfo(points: out, distanceKm: distance / 1000, durationMin: duration / 60);
    } catch (_) {
      return null;
    }
  }

  /// Calculate total distance in km between a list of points using Haversine.
  static double calculateDistanceKm(List<LatLng> route) {
    double total = 0;
    for (int i = 1; i < route.length; i++) {
      total += _haversine(route[i - 1], route[i]);
    }
    return total;
  }

  static double _haversine(LatLng a, LatLng b) {
    const r = 6371.0;
    final dLat = _deg2rad(b.latitude - a.latitude);
    final dLon = _deg2rad(b.longitude - a.longitude);
    final sinLat = math.sin(dLat / 2);
    final sinLon = math.sin(dLon / 2);
    final aVal = sinLat * sinLat + math.cos(_deg2rad(a.latitude)) * math.cos(_deg2rad(b.latitude)) * sinLon * sinLon;
    return 2 * r * math.asin(math.sqrt(aVal));
  }

  static double _deg2rad(double deg) => deg * (3.141592653589793 / 180);
}
