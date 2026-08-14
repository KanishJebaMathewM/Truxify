import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:truxify/core/api_client.dart';
import 'package:truxify/services/tracking_service.dart';

TrackingService _service(MockClient client) => TrackingService(
      apiClient: ApiClient(
        httpClient: client,
        baseUrl: 'http://localhost:5000',
      ),
    );

void main() {
  group('TrackingService.shareTrackingLink', () {
    test('posts to expected path and returns response map', () async {
      final client = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/api/orders/ord-123/share-tracking');
        return http.Response(
          jsonEncode({
            'trackingUrl': 'https://truxify.app/t/abc123',
            'token': 'abc123',
            'expiresAt': '2026-01-01T00:00:00Z',
          }),
          200,
        );
      });

      final result = await _service(client).shareTrackingLink(orderDisplayId: 'ord-123');

      expect(result['trackingUrl'], 'https://truxify.app/t/abc123');
      expect(result['token'], 'abc123');
    });

    test('returns empty map on non-map response', () async {
      final client = MockClient((request) async {
        return http.Response('[1, 2]', 200);
      });

      final result = await _service(client).shareTrackingLink(orderDisplayId: 'ord-123');

      expect(result, isEmpty);
    });

    test('throws StateError on API error', () async {
      final client = MockClient((request) async {
        return http.Response('Forbidden', 403);
      });

      expect(
        () => _service(client).shareTrackingLink(orderDisplayId: 'ord-123'),
        throwsA(isA<StateError>()),
      );
    });
  });

  group('TrackingService.revokeTrackingLink', () {
    test('posts to expected path on success', () async {
      final client = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/api/orders/ord-123/share-tracking/revoke');
        return http.Response('{}', 200);
      });

      await _service(client).revokeTrackingLink(orderDisplayId: 'ord-123');
    });

    test('throws StateError on API error', () async {
      final client = MockClient((request) async {
        return http.Response('Not found', 404);
      });

      expect(
        () => _service(client).revokeTrackingLink(orderDisplayId: 'ord-123'),
        throwsA(isA<StateError>()),
      );
    });
  });

  group('TrackingService.fetchPublicTracking', () {
    test('gets expected path and returns map', () async {
      final client = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/public/tracking/tok-1');
        return http.Response(
          jsonEncode({'order': {'id': 'o1'}, 'driver_location': null}),
          200,
        );
      });

      final result = await _service(client).fetchPublicTracking('tok-1');

      expect(result, isNotNull);
      expect(result!['order'], isNotNull);
    });

    test('returns null on 404', () async {
      final client = MockClient((request) async {
        return http.Response('Not found', 404);
      });

      final result = await _service(client).fetchPublicTracking('tok-1');

      expect(result, isNull);
    });

    test('returns null on 410', () async {
      final client = MockClient((request) async {
        return http.Response('Gone', 410);
      });

      final result = await _service(client).fetchPublicTracking('tok-1');

      expect(result, isNull);
    });

    test('throws StateError on other errors', () async {
      final client = MockClient((request) async {
        return http.Response('Server error', 500);
      });

      expect(
        () => _service(client).fetchPublicTracking('tok-1'),
        throwsA(isA<StateError>()),
      );
    });
  });

  group('TrackingService.fetchPublicRoute', () {
    test('gets expected path and returns map', () async {
      final client = MockClient((request) async {
        expect(request.url.path, '/api/public/tracking/tok-1/route');
        return http.Response(jsonEncode({'coordinates': []}), 200);
      });

      final result = await _service(client).fetchPublicRoute('tok-1');

      expect(result, isNotNull);
    });

    test('returns null on 404', () async {
      final client = MockClient((request) async {
        return http.Response('Not found', 404);
      });

      final result = await _service(client).fetchPublicRoute('tok-1');

      expect(result, isNull);
    });
  });
}
