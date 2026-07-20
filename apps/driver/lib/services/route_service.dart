import 'dart:convert';

import 'package:http/http.dart' as http;
import '../core/config.dart';
import 'package:latlong2/latlong.dart';

class RouteService {
  /// Fetch a driving route from OSRM between the given [points].
  /// Returns a list of LatLng forming the route polyline (in order).
  static Future<List<LatLng>> fetchRouteGeoJson(List<LatLng> points) async {
    if (points.length < 2) return [];
    final coords = points.map((p) => '${p.longitude},${p.latitude}').join(';');
    final url = Uri.parse('https://router.project-osrm.org/route/v1/driving/$coords?overview=full&geometries=geojson');
    try {
      final resp = await http.get(url).timeout(AppConfig.routeTimeout);
      if (resp.statusCode != 200) return [];

      final decoded = json.decode(resp.body);
      if (decoded is! Map<String, dynamic>) return [];

      final routes = decoded['routes'];
      if (routes is! List || routes.isEmpty) return [];

      final firstRoute = routes.first;
      if (firstRoute is! Map<String, dynamic>) return [];

      final geometry = firstRoute['geometry'];
      if (geometry is! Map<String, dynamic>) return [];

      final coordsList = geometry['coordinates'];
      if (coordsList is! List) return [];

      final out = <LatLng>[];
      for (final e in coordsList) {
        if (e is List && e.length >= 2) {
          final lonValue = e[0];
          final latValue = e[1];
          if (lonValue is! num || latValue is! num) {
            continue;
          }

          final lon = lonValue.toDouble();
          final lat = latValue.toDouble();
          out.add(LatLng(lat, lon));
        }
      }
      return out;
    } catch (_) {
      return [];
    }
  }
}
