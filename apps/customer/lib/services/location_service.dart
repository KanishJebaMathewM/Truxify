import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

class LocationSuggestion {
  const LocationSuggestion({required this.address, required this.point});

  final String address;
  final LatLng point;
}

class LocationService {
  static const String _host = 'nominatim.openstreetmap.org';
  static const String _userAgent = 'Truxify Customer App';
  static const int _maxCacheSize = 200;
  static const Duration _lookupTimeout = Duration(seconds: 8);
  static final Map<String, List<LocationSuggestion>> _searchCache = {};
  static final Map<String, String> _reverseCache = {};

  static void _cacheSearch(String query, List<LocationSuggestion> results) {
    if (_searchCache.length >= _maxCacheSize) {
      _searchCache.remove(_searchCache.keys.first);
    }
    _searchCache[query.toLowerCase().trim()] = results;
  }

  Future<List<LocationSuggestion>> searchPlaces(String query) async {
    final trimmed = query.trim();
    if (trimmed.length < 3) {
      return const <LocationSuggestion>[];
    }

    final cacheKey = trimmed.toLowerCase();
    if (_searchCache.containsKey(cacheKey)) {
      return _searchCache[cacheKey]!;
    }

    final uri = Uri.https(
      _host,
      '/search',
      <String, String>{
        'q': trimmed,
        'format': 'jsonv2',
        'addressdetails': '1',
        'limit': '6',
      },
    );

    final response = await http.get(
      uri,
      headers: const <String, String>{
        'Accept': 'application/json',
        'User-Agent': _userAgent,
      },
    ).timeout(_lookupTimeout);
    if (response.statusCode != 200) {
      throw Exception('Search failed: ${response.statusCode} (${uri.path})');
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! List) {
      throw Exception('Search failed: unexpected response type (${uri.path})');
    }
    final results = decoded
        .map((item) {
          if (item is! Map<String, dynamic>) return null;
          final json = item;
          final lat = double.tryParse('${json['lat']}');
          final lon = double.tryParse('${json['lon']}');
          final displayName = (json['display_name'] as String?)?.trim() ?? '';
          if (lat == null || lon == null || displayName.isEmpty) {
            return null;
          }

          return LocationSuggestion(
            address: displayName,
            point: LatLng(lat, lon),
          );
        })
        .whereType<LocationSuggestion>()
        .toList();

    _cacheSearch(cacheKey, results);
    return results;
  }

  Future<String> resolveAddress(LatLng point) async {
    final cacheKey = '${point.latitude.toStringAsFixed(4)},${point.longitude.toStringAsFixed(4)}';
    if (_reverseCache.containsKey(cacheKey)) {
      return _reverseCache[cacheKey]!;
    }
    final uri = Uri.https(
      _host,
      '/reverse',
      <String, String>{
        'lat': point.latitude.toStringAsFixed(6),
        'lon': point.longitude.toStringAsFixed(6),
        'format': 'jsonv2',
      },
    );

    final response = await http.get(
      uri,
      headers: const <String, String>{
        'Accept': 'application/json',
        'User-Agent': _userAgent,
      },
    ).timeout(_lookupTimeout);
    if (response.statusCode != 200) {
      throw Exception('Reverse lookup failed: ${response.statusCode} (${uri.path})');
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) throw Exception('Reverse lookup failed: unexpected response type');
    final displayName = (decoded['display_name'] as String?)?.trim();
    if (displayName != null && displayName.isNotEmpty) {
      _reverseCache[cacheKey] = displayName;
      return displayName;
    }

    throw Exception('Reverse lookup failed: missing display_name (${uri.path})');
  }

  String extractCity(String address) {
    final parts = address
        .split(',')
        .map((part) => part.trim())
        .where((part) => part.isNotEmpty)
        .toList();
    if (parts.length >= 3) return parts[parts.length - 3];
    return parts.isEmpty ? '' : parts.first;
  }

  String extractShortAddress(String address) {
    final parts = address.split(',').map((p) => p.trim()).toList();
    if (parts.length > 3) return parts.sublist(0, 3).join(', ');
    return address;
  }

  void clearCache() {
    _searchCache.clear();
    _reverseCache.clear();
  }
}
