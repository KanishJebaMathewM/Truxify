import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:truxify_shared/src/services/api_client.dart';

/// A no-op [http.Client] so we can construct [ApiClient] without hitting the
/// network — we only care about the base-URL scheme validation (#13094).
class _NoopClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    return http.StreamedResponse(Stream.value(<int>[]), 200);
  }

  @override
  void close() {}
}

void main() {
  group('ApiClient base URL scheme enforcement (#13094)', () {
    test('rejects a cleartext http base URL', () {
      // #13094 deliberately permits http://localhost:<port> and
      // http://10.0.2.2:<port> in dev mode — a non-localhost cleartext URL is
      // the case that must throw.
      expect(
        () => ApiClient(baseUrl: 'http://api.example.com'),
        throwsA(isA<StateError>()),
      );
    });

    test('permits http://localhost in dev mode (the #13094 exception)', () {
      expect(
        () => ApiClient(baseUrl: 'http://localhost:5000'),
        returnsNormally,
      );
    });

    test('accepts an https base URL', () {
      final client = ApiClient(
        baseUrl: 'https://example.test',
        httpClient: _NoopClient(),
      );
      expect(client, isA<ApiClient>());
      client.close();
    });
  });
}
