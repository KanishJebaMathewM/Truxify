import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:truxify_shared/src/services/api_client.dart';

/// A fake [http.Client] that always answers with HTTP 429 so we can exercise
/// [ApiClient._decode]'s [RateLimitException] construction without touching a
/// real backend.
class _FakeRateLimitClient extends http.BaseClient {
  _FakeRateLimitClient(this.retryAfterHeader, this.body);

  final String? retryAfterHeader;
  final String body;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final headers = <String, String>{};
    if (retryAfterHeader != null) {
      headers['retry-after'] = retryAfterHeader!;
    }
    return http.StreamedResponse(
      Stream.value(utf8.encode(body)),
      429,
      request: request,
      headers: headers,
      reasonPhrase: 'Too Many Requests',
    );
  }

  @override
  void close() {}
}

void main() {
  group('ApiClient._decode RateLimitException retryAfter clamping', () {
    test('missing retry-after header defaults to 1s (no zero delay)', () async {
      final client = ApiClient(
        httpClient: _FakeRateLimitClient(null, '{"error":"rate limited"}'),
        baseUrl: 'https://example.test',
      );

      late RateLimitException error;
      try {
        await client.get('/x');
      } on RateLimitException catch (e) {
        error = e;
      }

      expect(error.retryAfter, const Duration(seconds: 1),
          reason: 'a missing Retry-After must never produce a zero delay');
      client.close();
    });

    test('retry-after: 0 is clamped to a minimum of 1s', () async {
      final client = ApiClient(
        httpClient: _FakeRateLimitClient('0', '{"error":"rate limited"}'),
        baseUrl: 'https://example.test',
      );

      late RateLimitException error;
      try {
        await client.get('/x');
      } on RateLimitException catch (e) {
        error = e;
      }

      expect(error.retryAfter, const Duration(seconds: 1),
          reason: 'retryAfter == 0 previously caused a retry storm');
      client.close();
    });

    test('retry-after: 100 is clamped to a maximum of 30s', () async {
      final client = ApiClient(
        httpClient: _FakeRateLimitClient('100', '{"error":"rate limited"}'),
        baseUrl: 'https://example.test',
      );

      late RateLimitException error;
      try {
        await client.get('/x');
      } on RateLimitException catch (e) {
        error = e;
      }

      expect(error.retryAfter, const Duration(seconds: 30));
      client.close();
    });
  });
}
