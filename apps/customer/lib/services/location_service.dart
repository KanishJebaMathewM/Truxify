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

  Future<List<LocationSuggestion>> searchPlaces(String query) async {
    final trimmed = query.trim();
    if (trimmed.length < 3) {
      return const <LocationSuggestion>[];
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
    );
    if (response.statusCode != 200) {
      throw Exception('Search failed: ${response.statusCode} (${uri.path})');
    }

    final decoded = jsonDecode(response.body) as List<dynamic>;
    return decoded
        .map((item) {
          final json = item as Map<String, dynamic>;
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
  }

  Future<String> resolveAddress(LatLng point) async {
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
    );
    if (response.statusCode != 200) {
      throw Exception('Reverse lookup failed: ${response.statusCode} (${uri.path})');
    }

    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final displayName = (decoded['display_name'] as String?)?.trim();
    if (displayName != null && displayName.isNotEmpty) {
      return displayName;
    }

    throw Exception('Reverse lookup failed: missing display_name (${uri.path})');
  }
}