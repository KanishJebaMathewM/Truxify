import 'dart:convert';

import 'package:http/http.dart' as http;
import '../core/config.dart';
import 'package:latlong2/latlong.dart';

/// Lightweight geocoding helper using Nominatim (OpenStreetMap).
class GeocodeService {
  GeocodeService._();

  static const int _maxCacheSize = 100;
  static final Map<String, LatLng?> _cache = <String, LatLng?>{};

  static void _addToCache(String key, LatLng? value) {
    if (_cache.length >= _maxCacheSize) {
      _cache.remove(_cache.keys.first);
    }
    _cache[key] = value;
  }

  /// Resolve a place name to a LatLng. Returns null if resolution failed.
  static Future<LatLng?> resolvePlace(String query) async {
    final key = query.trim().toLowerCase();
    if (key.isEmpty) return null;
    if (_cache.containsKey(key)) return _cache[key];

    final uri = Uri.https(
      'nominatim.openstreetmap.org',
      '/search',
      <String, String>{'q': query, 'format': 'jsonv2', 'limit': '1'},
    );

    try {
      final resp = await http
          .get(uri, headers: const {
            'Accept': 'application/json',
            'User-Agent': 'Truxify-Driver-App',
          })
          .timeout(AppConfig.geocodeTimeout);
      if (resp.statusCode != 200) {
        _addToCache(key, null);
        return null;
      }

      final decoded = jsonDecode(resp.body) as List<dynamic>?;
      if (decoded == null || decoded.isEmpty) {
        _addToCache(key, null);
        return null;
      }

      final item = decoded.first as Map<String, dynamic>;
      final lat = double.tryParse('${item['lat']}');
      final lon = double.tryParse('${item['lon']}');
      if (lat == null || lon == null) {
        _addToCache(key, null);
        return null;
      }

      final ll = LatLng(lat, lon);
      _addToCache(key, ll);
      return ll;
    } catch (_) {
      _addToCache(key, null);
      return null;
    }
  }
}
