import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:truxify_driver/services/api_client.dart';
import 'package:truxify_driver/services/driver_earnings_service.dart';

import 'setup.dart';

/// A mock [http.Client] that returns a fixed response for every request.
class MockHttpClient extends http.BaseClient {
  final Future<http.Response> Function(http.BaseRequest request) handler;
  MockHttpClient(this.handler);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = await handler(request);
    return http.StreamedResponse(
      Stream.value(response.bodyBytes),
      response.statusCode,
      headers: response.headers,
      request: request,
    );
  }
}

void main() {
  setUpAll(() async {
    await setupTests();
  });

  group('DriverEarningsService.withdrawFunds', () {
    late MockHttpClient httpClient;
    late DriverEarningsService service;

    void buildService(Future<http.Response> Function(http.BaseRequest) handler) {
      httpClient = MockHttpClient(handler);
      final apiClient = ApiClient(
        httpClient: httpClient,
        baseUrl: 'http://localhost:5000',
      );
      service = DriverEarningsService(apiClient: apiClient);
    }

    tearDown(() {
      service.dispose();
      httpClient.close();
    });

    test('returns parsed response on 200 success', () async {
      final mockResponse = {
        'message': 'Withdrawal successful',
        'withdrawnAmount': 50000,
      };

      buildService((request) async {
        expect(request.url.path, equals('/api/driver/wallet/withdraw'));
        expect(request.method, equals('POST'));
        expect(request.headers['Content-Type'], equals('application/json'));

        final body = jsonDecode(request.body as String) as Map<String, dynamic>;
        expect(body['amount'], equals(50000));

        return http.Response(jsonEncode(mockResponse), 200);
      });

      final result = await service.withdrawFunds(50000);
      expect(result, isA<Map<String, dynamic>>());
      expect(result['withdrawnAmount'], equals(50000));
    });

    test('throws ApiException with status 400 on bad request', () async {
      buildService((request) async {
        return http.Response(
          jsonEncode({'error': 'Amount exceeds available balance. Available: 30000 paisa'}),
          400,
        );
      });

      expect(
        () => service.withdrawFunds(50000),
        throwsA(
          isA<ApiException>().having(
            (e) => e.statusCode,
            'statusCode',
            equals(400),
          ),
        ),
      );
    });

    test('throws ApiException with status 404 when driver not found', () async {
      buildService((request) async {
        return http.Response(
          jsonEncode({'error': 'Driver not found'}),
          404,
        );
      });

      expect(
        () => service.withdrawFunds(10000),
        throwsA(
          isA<ApiException>().having(
            (e) => e.statusCode,
            'statusCode',
            equals(404),
          ),
        ),
      );
    });

    test('throws ApiException with status 500 on server error', () async {
      buildService((request) async {
        return http.Response(
          jsonEncode({'error': 'Internal server error'}),
          500,
        );
      });

      expect(
        () => service.withdrawFunds(10000),
        throwsA(
          isA<ApiException>().having(
            (e) => e.statusCode,
            'statusCode',
            equals(500),
          ),
        ),
      );
    });

    test('throws generic exception on network failure', () async {
      buildService((request) async {
        throw Exception('Connection refused');
      });

      expect(
        () => service.withdrawFunds(10000),
        throwsA(
          isA<Exception>().having(
            (e) => e.toString(),
            'message',
            contains('Connection refused'),
          ),
        ),
      );
    });
  });
}
