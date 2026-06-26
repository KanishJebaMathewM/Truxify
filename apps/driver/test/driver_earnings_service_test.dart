import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_driver/services/driver_earnings_service.dart';

import 'setup.dart';

class MockGoTrueClient implements GoTrueClient {
  final User? mockUser;
  final Session? mockSession;
  MockGoTrueClient({this.mockUser, this.mockSession});
  
  @override
  User? get currentUser => mockUser;
  
  @override
  Session? get currentSession => mockSession;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeUser implements User {
  final String _id;
  FakeUser(this._id);
  @override
  String get id => _id;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeSession implements Session {
  final String _token;
  FakeSession(this._token);
  @override
  String get accessToken => _token;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakePostgrestFilterBuilder<T> implements PostgrestFilterBuilder<T> {
  final Future<dynamic> _futureValue;
  FakePostgrestFilterBuilder(this._futureValue);

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #then) {
      final Function onValue = invocation.positionalArguments[0] as Function;
      final Function? onError = invocation.namedArguments[#onError] as Function?;
      return _futureValue.then((val) => onValue(val), onError: onError);
    }
    return this;
  }
}

class FakeSupabaseQueryBuilder implements SupabaseQueryBuilder {
  final Future<dynamic> _futureValue;
  FakeSupabaseQueryBuilder(this._futureValue);

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #select) {
      return FakePostgrestFilterBuilder<List<Map<String, dynamic>>>(_futureValue);
    }
    return this;
  }
}

class FakeSupabaseClient implements SupabaseClient {
  final GoTrueClient _auth;
  final Function(String relation)? onFrom;
  final Future<dynamic> Function(String relation)? queryResult;
  
  FakeSupabaseClient({
    required GoTrueClient auth,
    this.onFrom,
    this.queryResult,
  }) : _auth = auth;

  @override
  GoTrueClient get auth => _auth;

  @override
  SupabaseQueryBuilder from(String relation) {
    onFrom?.call(relation);
    final resultFuture = queryResult?.call(relation) ?? Future.value(<Map<String, dynamic>>[]);
    return FakeSupabaseQueryBuilder(resultFuture);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class MockHttpClient extends http.BaseClient {
  final Future<http.Response> Function(http.BaseRequest request) mockHandler;
  MockHttpClient(this.mockHandler);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = await mockHandler(request);
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

  group('DriverEarningsService Tests', () {
    const driverId = 'driver-123';
    final mockUser = FakeUser(driverId);
    final mockSession = FakeSession('mock-token');
    final mockAuth = MockGoTrueClient(mockUser: mockUser, mockSession: mockSession);

    test('fetchWalletTransactions returns parsed transactions on success', () async {
      final mockResponse = {
        'transactions': [
          {'id': 'txn-1', 'amount': 1000, 'status': 'completed', 'description': 'Trip pay'},
          {'id': 'txn-2', 'amount': 500, 'status': 'pending', 'description': 'Ref pay'},
        ]
      };

      final httpClient = MockHttpClient((request) async {
        expect(request.url.path, equals('/api/driver/wallet/history'));
        expect(request.url.queryParameters['page'], equals('1'));
        expect(request.url.queryParameters['limit'], equals('10'));
        return http.Response(jsonEncode(mockResponse), 200);
      });

      final supabaseClient = FakeSupabaseClient(auth: mockAuth);
      final service = DriverEarningsService(
        client: supabaseClient,
        httpClient: httpClient,
      );

      final result = await service.fetchWalletTransactions(page: 1, limit: 10);
      expect(result.length, equals(2));
      expect(result[0]['id'], equals('txn-1'));
      expect(result[1]['status'], equals('pending'));
      
      service.dispose();
    });

    test('fetchWalletTransactions throws exception on API error', () async {
      final httpClient = MockHttpClient((request) async {
        return http.Response(jsonEncode({'error': 'Unauthorized access'}), 401);
      });

      final supabaseClient = FakeSupabaseClient(auth: mockAuth);
      final service = DriverEarningsService(
        client: supabaseClient,
        httpClient: httpClient,
      );

      expect(
        () => service.fetchWalletTransactions(),
        throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('Unauthorized access'))),
      );
      
      service.dispose();
    });

    test('fetchMonthlyEarnings returns filtered earnings for current month', () async {
      final mockResponse = [
        {'day_date': '2026-06-01', 'amount': 2000, 'trip_count': 1, 'hours_driven': 2.5},
        {'day_date': '2026-06-15', 'amount': 4500, 'trip_count': 2, 'hours_driven': 5.0},
        {'day_date': '2026-05-31', 'amount': 1000, 'trip_count': 1, 'hours_driven': 1.0}, // outside requested month
      ];

      final httpClient = MockHttpClient((request) async {
        expect(request.url.path, equals('/api/driver/earnings/summary'));
        return http.Response(jsonEncode(mockResponse), 200);
      });

      final supabaseClient = FakeSupabaseClient(auth: mockAuth);
      final service = DriverEarningsService(
        client: supabaseClient,
        httpClient: httpClient,
      );

      // Querying June 2026
      final result = await service.fetchMonthlyEarnings(month: DateTime(2026, 6));
      expect(result.length, equals(2));
      expect(result[0]['day_date'], equals('2026-06-01'));
      expect(result[1]['day_date'], equals('2026-06-15'));
      
      service.dispose();
    });

    test('fetchMonthlyEarnings falls back to database for dates > 365 days ago', () async {
      bool databaseCalled = false;
      final supabaseClient = FakeSupabaseClient(
        auth: mockAuth,
        onFrom: (relation) {
          expect(relation, equals('earnings_daily'));
          databaseCalled = true;
        },
        queryResult: (relation) {
          return Future.value([
            {'day_date': '2020-01-15', 'amount': 3000, 'trip_count': 2, 'hours_driven': 4.0}
          ]);
        },
      );

      final httpClient = MockHttpClient((request) async {
        fail('HTTP client should not be called for historical months older than 365 days');
      });

      final service = DriverEarningsService(
        client: supabaseClient,
        httpClient: httpClient,
      );

      // Querying January 2020 (way older than 365 days)
      final result = await service.fetchMonthlyEarnings(month: DateTime(2020, 1));
      expect(databaseCalled, isTrue);
      expect(result.length, equals(1));
      expect(result[0]['amount'], equals(3000));
      
      service.dispose();
    });

    test('fetchCompletedTripsForDay queries trips table via supabase client', () async {
      bool databaseCalled = false;
      final supabaseClient = FakeSupabaseClient(
        auth: mockAuth,
        onFrom: (relation) {
          expect(relation, equals('trips'));
          databaseCalled = true;
        },
        queryResult: (relation) {
          return Future.value([
            {'id': 'trip-1', 'status': 'completed', 'trip_date': '2026-06-15'}
          ]);
        },
      );

      final service = DriverEarningsService(client: supabaseClient);
      final result = await service.fetchCompletedTripsForDay(date: DateTime(2026, 6, 15));
      expect(databaseCalled, isTrue);
      expect(result.length, equals(1));
      expect(result[0]['id'], equals('trip-1'));
      
      service.dispose();
    });

    test('fetchWalletSummary queries driver_details table via supabase client', () async {
      bool databaseCalled = false;
      final supabaseClient = FakeSupabaseClient(
        auth: mockAuth,
        onFrom: (relation) {
          expect(relation, equals('driver_details'));
          databaseCalled = true;
        },
        queryResult: (relation) {
          return Future.value([
            {
              'wallet_confirmed': 4500000,
              'wallet_pending': 850000,
              'wallet_total': 5350000
            }
          ]);
        },
      );

      final service = DriverEarningsService(client: supabaseClient);
      final result = await service.fetchWalletSummary();
      expect(databaseCalled, isTrue);
      expect(result['wallet_confirmed'], equals(4500000));
      expect(result['wallet_pending'], equals(850000));
      expect(result['wallet_total'], equals(5350000));
      
      service.dispose();
    });
  });
}
