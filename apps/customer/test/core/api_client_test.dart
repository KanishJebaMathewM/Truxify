import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:mocktail/mocktail.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify/core/api_client.dart';

import '../setup.dart';

// ── Mocks ─────────────────────────────────────────────────────────────

class MockHttpClient extends Mock implements http.Client {}
class MockSupabaseClient extends Mock implements SupabaseClient {}
class MockGoTrueClient extends Mock implements GoTrueClient {}
class MockSession extends Mock implements Session {}
class MockUser extends Mock implements User {}

// ── Helpers ───────────────────────────────────────────────────────────

http.Response jsonResponse(Object body, {int status = 200}) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

const String kBaseUrl = 'http://localhost:5000';
const String kMockToken = 'mock_access_token';
const String kRefreshedToken = 'refreshed_access_token';

ApiClient buildClient({
  required MockHttpClient httpClient,
  required MockSupabaseClient supabaseClient,
}) =>
    ApiClient(
      supabaseClient: supabaseClient,
      httpClient: httpClient,
      baseUrl: kBaseUrl,
    );

void main() {
  late MockHttpClient httpClient;
  late MockSupabaseClient supabaseClient;
  late MockGoTrueClient authClient;
  late MockSession session;

  setUpAll(() async {
    await setupTests();
    registerFallbackValue(Uri());
    registerFallbackValue(<String, String>{});
  });

  setUp(() {
    httpClient = MockHttpClient();
    supabaseClient = MockSupabaseClient();
    authClient = MockGoTrueClient();
    session = MockSession();

    when(() => supabaseClient.auth).thenReturn(authClient);
    when(() => authClient.currentSession).thenReturn(session);
    when(() => session.accessToken).thenReturn(kMockToken);
  });

  // ── Header injection ───────────────────────────────────────────────

  group('Authorization header injection', () {
    test('GET attaches Bearer token from current session', () async {
      when(() => httpClient.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => jsonResponse({'ok': true}));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);
      await client.get('/api/orders');

      final captured = verify(
        () => httpClient.get(any(), headers: captureAny(named: 'headers')),
      ).captured;
      final headers = captured.first as Map<String, String>;
      expect(headers['Authorization'], equals('Bearer $kMockToken'));
    });

    test('POST attaches Bearer token', () async {
      when(() => httpClient.post(any(),
              headers: any(named: 'headers'), body: any(named: 'body')))
          .thenAnswer((_) async => jsonResponse({'id': '123'}));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);
      await client.post('/api/orders', body: {'key': 'value'});

      final captured = verify(
        () => httpClient.post(any(),
            headers: captureAny(named: 'headers'),
            body: any(named: 'body')),
      ).captured;
      final headers = captured.first as Map<String, String>;
      expect(headers['Authorization'], equals('Bearer $kMockToken'));
    });

    test('PUT attaches Bearer token', () async {
      when(() => httpClient.put(any(),
              headers: any(named: 'headers'), body: any(named: 'body')))
          .thenAnswer((_) async => jsonResponse({'updated': true}));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);
      await client.put('/api/profile', body: {'full_name': 'Test'});

      final captured = verify(
        () => httpClient.put(any(),
            headers: captureAny(named: 'headers'),
            body: any(named: 'body')),
      ).captured;
      final headers = captured.first as Map<String, String>;
      expect(headers['Authorization'], equals('Bearer $kMockToken'));
    });

    test('omits Authorization header when no session exists', () async {
      when(() => authClient.currentSession).thenReturn(null);
      when(() => httpClient.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => jsonResponse({'ok': true}));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);
      await client.get('/api/health');

      final captured = verify(
        () => httpClient.get(any(), headers: captureAny(named: 'headers')),
      ).captured;
      final headers = captured.first as Map<String, String>;
      expect(headers.containsKey('Authorization'), isFalse);
    });
  });

  // ── Token refresh and retry ────────────────────────────────────────

  group('Token refresh on 401', () {
    test('retries with refreshed token after 401', () async {
      final refreshedSession = MockSession();
      when(() => refreshedSession.accessToken).thenReturn(kRefreshedToken);

      var callCount = 0;
      when(() => httpClient.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async {
        callCount++;
        if (callCount == 1) {
          return http.Response('{"error":"Unauthorized"}', 401);
        }
        return jsonResponse({'orders': []});
      });

      when(() => authClient.refreshSession()).thenAnswer((_) async =>
          AuthResponse(session: refreshedSession, user: MockUser()));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);
      final result = await client.get('/api/orders');

      expect(result, isA<Map>());
      expect(callCount, equals(2));

      final captured = verify(
        () => httpClient.get(any(), headers: captureAny(named: 'headers')),
      ).captured;
      // Second call should use the refreshed token
      final retryHeaders = captured.last as Map<String, String>;
      expect(retryHeaders['Authorization'], equals('Bearer $kRefreshedToken'));
    });

    test('throws ApiAuthException when refresh fails', () async {
      when(() => httpClient.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async =>
              http.Response('{"error":"Unauthorized"}', 401));

      when(() => authClient.refreshSession())
          .thenThrow(Exception('refresh failed'));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);

      await expectLater(
        () => client.get('/api/orders'),
        throwsA(isA<ApiAuthException>()),
      );
    });

    test('throws ApiAuthException when retry after refresh still returns 401',
        () async {
      final refreshedSession = MockSession();
      when(() => refreshedSession.accessToken).thenReturn(kRefreshedToken);

      when(() => httpClient.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async =>
              http.Response('{"error":"Unauthorized"}', 401));

      when(() => authClient.refreshSession()).thenAnswer((_) async =>
          AuthResponse(session: refreshedSession, user: MockUser()));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);

      await expectLater(
        () => client.get('/api/orders'),
        throwsA(isA<ApiAuthException>()),
      );
    });

    test('does not retry on non-401 errors', () async {
      when(() => httpClient.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async =>
              http.Response('{"error":"Not Found"}', 404));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);

      await expectLater(
        () => client.get('/api/orders/nonexistent'),
        throwsA(isA<ApiException>()),
      );

      verifyNever(() => authClient.refreshSession());
    });
  });

  // ── Error handling ─────────────────────────────────────────────────

  group('ApiException on non-2xx responses', () {
    test('throws ApiException with status code on 500', () async {
      when(() => httpClient.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async =>
              http.Response('{"error":"Internal Server Error"}', 500));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);

      await expectLater(
        () => client.get('/api/orders'),
        throwsA(
          isA<ApiException>().having((e) => e.statusCode, 'statusCode', 500),
        ),
      );
    });

    test('throws ApiException when a successful response is not valid JSON', () async {
      when(() => httpClient.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => http.Response('not-json', 200));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);

      await expectLater(
        () => client.get('/api/orders'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'statusCode', 200)
              .having((e) => e.message, 'message', 'Invalid JSON response'),
        ),
      );
    });
  });

  // ── Core enhancements ──────────────────────────────────────────────

  group('ApiClient Core Enhancements', () {
    test('normalises paths with and without leading slash', () async {
      when(() => httpClient.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => jsonResponse({'ok': true}));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);

      // Path without leading slash
      await client.get('api/orders');
      verify(() => httpClient.get(Uri.parse('http://localhost:5000/api/orders'), headers: any(named: 'headers'))).called(1);

      // Path with leading slash
      await client.get('/api/orders');
      verify(() => httpClient.get(Uri.parse('http://localhost:5000/api/orders'), headers: any(named: 'headers'))).called(1);
    });

    test('encodes raw path segments while preserving query strings', () async {
      when(() => httpClient.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => jsonResponse({'ok': true}));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);

      await client.get('/api/orders/ORD 123/timeline?include=driver notes');

      final captured = verify(
        () => httpClient.get(captureAny(), headers: any(named: 'headers')),
      ).captured;
      final uri = captured.single as Uri;
      expect(
        uri.toString(),
        equals('http://localhost:5000/api/orders/ORD%20123/timeline?include=driver%20notes'),
      );
    });

    test('accepts custom headers and merges them', () async {
      when(() => httpClient.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => jsonResponse({'ok': true}));

      final client = buildClient(
          httpClient: httpClient, supabaseClient: supabaseClient);

      await client.get('/api/orders', headers: {'custom-key': 'custom-val'});

      final captured = verify(
        () => httpClient.get(any(), headers: captureAny(named: 'headers')),
      ).captured;
      final headers = captured.first as Map<String, String>;
      expect(headers['Authorization'], equals('Bearer $kMockToken'));
      expect(headers['custom-key'], equals('custom-val'));
    });

    test('dispose closes http client if owned', () {
      final client = ApiClient(supabaseClient: supabaseClient);
      client.dispose();
    });
  });
}
