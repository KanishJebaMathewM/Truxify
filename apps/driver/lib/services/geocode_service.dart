import 'dart:convert';

import 'package:http/http.dart' as http;
import '../core/config.dart';
import 'package:latlong2/latlong.dart';

/// A single place search result with display name and coordinates.
class SearchResult {
  const SearchResult({required this.address, required this.point});

  final String address;
  final LatLng point;
}

/// Lightweight geocoding helper using Nominatim (OpenStreetMap).
class GeocodeService {
  GeocodeService._();

  static const int _maxCacheSize = 100;
  static const Duration _cacheTtl = Duration(minutes: 30);
  static final Map<String, _CacheEntry<LatLng?>> _cache = <String, _CacheEntry<LatLng?>>{};
  static final Map<String, _CacheEntry<String>> _reverseCache = <String, _CacheEntry<String>>{};

  static void _evictExpired() {
    final now = DateTime.now();
    _cache.removeWhere((_, entry) => now.difference(entry.cachedAt) > _cacheTtl);
    _reverseCache.removeWhere((_, entry) => now.difference(entry.cachedAt) > _cacheTtl);
  }

  static void _addToCache(String key, LatLng? value) {
    _evictExpired();
    if (_cache.length >= _maxCacheSize) {
      _cache.remove(_cache.keys.first);
    }
    _cache[key] = _CacheEntry(value, DateTime.now());
  }

  /// Resolve a place name to a LatLng. Returns null if resolution failed.
  static Future<LatLng?> resolvePlace(String query) async {
    final key = query.trim().toLowerCase();
    if (key.isEmpty) return null;
    final cached = _cache[key];
    if (cached != null) return cached.value;
    _evictExpired();

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
        return null;
      }

      final decoded = jsonDecode(resp.body) as List<dynamic>?;
      if (decoded == null || decoded.isEmpty) {
        return null;
      }

      final first = decoded.first;
      if (first is! Map<String, dynamic>) {
        return null;
      }
      final item = first;
      final lat = double.tryParse('${item['lat']}');
      final lon = double.tryParse('${item['lon']}');
      if (lat == null || lon == null) {
        return null;
      }

      final displayName = item['display_name'] as String? ?? query;
      final ll = LatLng(lat, lon);
      _addToCache(key, ll);
      _reverseCache['$lat,$lon'] = _CacheEntry(displayName, DateTime.now());
      return ll;
    } catch (e) {
      print('Error: $e');
      return null;
    }
  }

  /// Reverse geocode coordinates to an address string.
  static Future<String?> reverseGeocode(LatLng point) async {
    final key = '${point.latitude},${point.longitude}';
    final cached = _reverseCache[key];
    if (cached != null) return cached.value;
    _evictExpired();

    final uri = Uri.https(
      'nominatim.openstreetmap.org',
      '/reverse',
      <String, String>{
        'lat': point.latitude.toStringAsFixed(6),
        'lon': point.longitude.toStringAsFixed(6),
        'format': 'jsonv2',
      },
    );

    try {
      final resp = await http
          .get(uri, headers: const {
            'Accept': 'application/json',
            'User-Agent': 'Truxify-Driver-App',
          })
          .timeout(const Duration(seconds: 6));
      if (resp.statusCode != 200) return null;

      final decoded = jsonDecode(resp.body) as Map<String, dynamic>?;
      final displayName = decoded?['display_name'] as String?;
      if (displayName != null && displayName.isNotEmpty) {
        _reverseCache[key] = _CacheEntry(displayName, DateTime.now());
      }
      return displayName;
    } catch (e) {
      print('Error: $e');
      return null;
    }
  }

  /// Search for autocomplete suggestions.
  static Future<List<String>> autocomplete(String query) async {
    if (query.trim().isEmpty) return [];
    final uri = Uri.https(
      'nominatim.openstreetmap.org',
      '/search',
      <String, String>{'q': query, 'format': 'jsonv2', 'limit': '5'},
    );
    try {
      final resp = await http
          .get(uri, headers: const {
            'Accept': 'application/json',
            'User-Agent': 'Truxify-Driver-App',
          })
          .timeout(const Duration(seconds: 4));
      if (resp.statusCode != 200) return [];
      final decoded = jsonDecode(resp.body) as List<dynamic>?;
      if (decoded == null) return [];
      return decoded
          .map((e) => (e as Map<String, dynamic>)['display_name'] as String? ?? '')
          .where((s) => s.isNotEmpty)
          .toList();
    } catch (e) {
      print('Error: $e');
      return [];
    }
  }

  /// Search for places matching [query], returning up to [limit] results
  /// with both display names and coordinates.
  ///
  /// An optional [client] can be provided for test-injection.
  static Future<List<SearchResult>> searchPlaces(
    String query, {
    http.Client? client,
    int limit = 6,
  }) async {
    final trimmed = query.trim();
    if (trimmed.length < 3) return [];

    final uri = Uri.https(
      'nominatim.openstreetmap.org',
      '/search',
      <String, String>{
        'q': trimmed,
        'format': 'jsonv2',
        'addressdetails': '1',
        'limit': '$limit',
      },
    );

    const headers = <String, String>{
      'Accept': 'application/json',
      'User-Agent': 'Truxify-Driver-App',
    };

    final http.Response resp;
    if (client != null) {
      resp = await client.get(uri, headers: headers).timeout(AppConfig.geocodeTimeout);
    } else {
      resp = await http.get(uri, headers: headers).timeout(AppConfig.geocodeTimeout);
    }
    if (resp.statusCode != 200) return [];

    final decoded = jsonDecode(resp.body) as List<dynamic>?;
    if (decoded == null) return [];

    return decoded
        .map((item) {
          if (item is! Map<String, dynamic>) return null;
          final lat = double.tryParse('${item['lat']}');
          final lon = double.tryParse('${item['lon']}');
          final displayName =
              (item['display_name'] as String?)?.trim() ?? '';
          if (lat == null || lon == null || displayName.isEmpty) return null;
          return SearchResult(
            address: displayName,
            point: LatLng(lat, lon),
          );
        })
        .whereType<SearchResult>()
        .toList();
  }

  static void clearCache() {
    _cache.clear();
    _reverseCache.clear();
  }
}

class _CacheEntry<T> {
  _CacheEntry(this.value, this.cachedAt);

  final T value;
  final DateTime cachedAt;
}
