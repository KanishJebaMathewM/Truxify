import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';
import 'package:truxify_driver/services/geocode_service.dart';

void main() {
  const point = LatLng(19.07609, 72.877426);

  setUp(GeocodeService.clearCache);

  group('GeocodeService.reverseGeocode', () {
    test('returns display name on 200 response', () async {
      final client = MockClient((request) async {
        expect(request.url.path, '/reverse');
        return http.Response(
          jsonEncode({'display_name': 'Mumbai, Maharashtra, India'}),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final result = await GeocodeService.reverseGeocode(point, client: client);

      expect(result, 'Mumbai, Maharashtra, India');
    });

    test('returns null on non-200 response', () async {
      final client = MockClient((request) async {
        return http.Response('Not Found', 404);
      });

      final result = await GeocodeService.reverseGeocode(point, client: client);

      expect(result, isNull);
    });

    test('returns null on network error', () async {
      final client = MockClient((request) async {
        throw http.ClientException('Simulated network error');
      });

      final result = await GeocodeService.reverseGeocode(point, client: client);

      expect(result, isNull);
    });

    test('returns null on malformed response body', () async {
      final client = MockClient((request) async {
        return http.Response('not json', 200);
      });

      final result = await GeocodeService.reverseGeocode(point, client: client);

      expect(result, isNull);
    });

    test('returns null when display_name is missing', () async {
      final client = MockClient((request) async {
        return http.Response(jsonEncode({'other': 'field'}), 200);
      });

      final result = await GeocodeService.reverseGeocode(point, client: client);

      expect(result, isNull);
    });
  });

  group('GeocodeService.searchPlaces', () {
    test('returns parsed results on 200 response', () async {
      final client = MockClient((request) async {
        expect(request.url.path, '/search');
        return http.Response(
          jsonEncode([
            {
              'display_name': 'Mumbai, Maharashtra, India',
              'lat': '19.0760900',
              'lon': '72.8774260',
            },
            {
              'display_name': 'Mumbai Central',
              'lat': '18.9696200',
              'lon': '72.8196360',
            },
          ]),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final results = await GeocodeService.searchPlaces('Mumbai', client: client);

      expect(results, hasLength(2));
      expect(results.first.address, 'Mumbai, Maharashtra, India');
      expect(results.first.point.latitude, closeTo(19.07609, 0.000001));
      expect(results.first.point.longitude, closeTo(72.877426, 0.000001));
    });

    test('returns empty list when no results', () async {
      final client = MockClient((request) async {
        return http.Response('[]', 200);
      });

      final results = await GeocodeService.searchPlaces('Nowhereville', client: client);

      expect(results, isEmpty);
    });

    test('returns empty list on non-200 response', () async {
      final client = MockClient((request) async {
        return http.Response('Error', 500);
      });

      final results = await GeocodeService.searchPlaces('Mumbai', client: client);

      expect(results, isEmpty);
    });

    test('returns empty list on network error', () async {
      final client = MockClient((request) async {
        throw http.ClientException('Simulated network error');
      });

      final results = await GeocodeService.searchPlaces('Mumbai', client: client);

      expect(results, isEmpty);
    });

    test('returns empty list on malformed response body', () async {
      final client = MockClient((request) async {
        return http.Response('not json', 200);
      });

      final results = await GeocodeService.searchPlaces('Mumbai', client: client);

      expect(results, isEmpty);
    });

    test('skips items missing coordinates or display name', () async {
      final client = MockClient((request) async {
        return http.Response(
          jsonEncode([
            {'display_name': 'Valid Place', 'lat': '1.0', 'lon': '2.0'},
            {'display_name': 'Missing coords'},
            {'lat': '3.0', 'lon': '4.0'},
            'not-a-map',
          ]),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final results = await GeocodeService.searchPlaces('Valid', client: client);

      expect(results, hasLength(1));
      expect(results.first.address, 'Valid Place');
    });

    test('returns empty list for short queries', () async {
      final client = MockClient((request) async {
        throw StateError('Should not be called for short queries');
      });

      final results = await GeocodeService.searchPlaces('mu', client: client);

      expect(results, isEmpty);
    });
  });
}
