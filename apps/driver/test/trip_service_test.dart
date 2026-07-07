import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_driver/services/trip_service.dart';

http.Client createUnusedHttpClient() => http.Client();

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

class FakePostgrestTransformBuilder<T> implements PostgrestTransformBuilder<T> {
  final Future<dynamic> _futureValue;

  FakePostgrestTransformBuilder(this._futureValue);

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #maybeSingle) {
      return FakePostgrestTransformBuilder<Map<String, dynamic>?>(_futureValue.then((val) {
        if (val is List && val.isNotEmpty) {
          return val.first as Map<String, dynamic>;
        } else if (val is Map<String, dynamic>) {
          return val;
        }
        return null;
      }));
    }
    if (invocation.memberName == #then) {
      final Function onValue = invocation.positionalArguments[0] as Function;
      final Function? onError = invocation.namedArguments[#onError] as Function?;
      return _futureValue.then((val) => onValue(val), onError: onError);
    }
    return this;
  }
}

class FakePostgrestFilterBuilder<T> implements PostgrestFilterBuilder<T> {
  final Future<dynamic> _futureValue;
  final Function(String, dynamic)? onEq;

  FakePostgrestFilterBuilder(this._futureValue, {this.onEq});

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #eq) {
      final String col = invocation.positionalArguments[0] as String;
      final Object val = invocation.positionalArguments[1];
      onEq?.call(col, val);
      return this;
    }
    if (invocation.memberName == #select) {
      return FakePostgrestTransformBuilder<List<Map<String, dynamic>>>(_futureValue);
    }
    if (invocation.memberName == #maybeSingle) {
      return FakePostgrestTransformBuilder<Map<String, dynamic>?>(_futureValue.then((val) {
        if (val is List && val.isNotEmpty) {
          return val.first as Map<String, dynamic>;
        } else if (val is Map<String, dynamic>) {
          return val;
        }
        return null;
      }));
    }
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
  final Function(String, dynamic)? onEq;
  final Function(Map)? onUpdate;

  FakeSupabaseQueryBuilder(this._futureValue, {this.onEq, this.onUpdate});

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #select) {
      return FakePostgrestFilterBuilder<List<Map<String, dynamic>>>(_futureValue, onEq: onEq);
    }
    if (invocation.memberName == #update) {
      final Map values = invocation.positionalArguments.first as Map;
      onUpdate?.call(values);
      return FakePostgrestFilterBuilder<List<Map<String, dynamic>>>(_futureValue, onEq: onEq);
    }
    if (invocation.memberName == #eq) {
      final String col = invocation.positionalArguments[0] as String;
      final Object val = invocation.positionalArguments[1];
      onEq?.call(col, val);
      return this;
    }
    if (invocation.memberName == #then) {
      final Function onValue = invocation.positionalArguments[0] as Function;
      final Function? onError = invocation.namedArguments[#onError] as Function?;
      return _futureValue.then((val) => onValue(val), onError: onError);
    }
    return this;
  }
}

class FakeSupabaseClient implements SupabaseClient {
  final FakeSupabaseQueryBuilder Function(String relation) onFrom;
  final GoTrueClient _auth;

  FakeSupabaseClient({required this.onFrom, GoTrueClient? auth})
      : _auth = auth ?? MockGoTrueClient();

  @override
  GoTrueClient get auth => _auth;

  @override
  SupabaseQueryBuilder from(String relation) {
    return onFrom(relation);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) {
    return super.noSuchMethod(invocation);
  }
}

void main() {
  const driverId = 'test-driver-123';
  const tripDisplayId = 'trip-display-456';
  const stopId = 'stop-789';

  final mockUser = FakeUser(driverId);
  final mockAuth = MockGoTrueClient(mockUser: mockUser);



  group('TripService.markStopCompleted Tests', () {
    // markStopCompleted now verifies ownership via Supabase and then
    // delegates the stop completion to the backend API; the progression
    // logic (next stop / trip completion) lives server-side.

    FakeSupabaseClient ownedTripClient() => FakeSupabaseClient(
          auth: mockAuth,
          onFrom: (relation) {
            if (relation == 'trips') {
              return FakeSupabaseQueryBuilder(
                Future.value([{'id': 'trip-id-123'}]),
              );
            }
            throw UnimplementedError('Table $relation not mocked');
          },
        );

    test('Successfully completes stop and sets next stop as current', () async {
      final requests = <http.Request>[];
      final mockHttp = MockClient((request) async {
        requests.add(request);
        return http.Response('{}', 200);
      });

      final service = TripService(client: ownedTripClient(), httpClient: mockHttp);

      await service.markStopCompleted(stopId, tripDisplayId);

      expect(requests, hasLength(1));
      expect(requests.first.method, equals('PUT'));
      expect(
        requests.first.url.path,
        equals('/api/trips/$tripDisplayId/stops/$stopId/complete'),
      );
    });

    test('Successfully completes last stop and completes the trip', () async {
      // The server owns the last-stop/trip-completion transition; the client
      // contract is simply that a 2xx response resolves without error.
      final mockHttp = MockClient((request) async {
        return http.Response('{"message": "Trip completed"}', 200);
      });

      final service = TripService(client: ownedTripClient(), httpClient: mockHttp);

      await expectLater(
        service.markStopCompleted(stopId, tripDisplayId),
        completes,
      );
    });

    test('Throws exception if stop update returns null (invalid stop ID or not belonging to trip)', () async {
      final mockHttp = MockClient((request) async {
        return http.Response(
          '{"error": "Stop not found or does not belong to this trip"}',
          404,
        );
      });

      final service = TripService(client: ownedTripClient(), httpClient: mockHttp);

      expect(
        () => service.markStopCompleted(stopId, tripDisplayId),
        throwsA(isA<Exception>().having((e) => e.toString(), 'message',
            contains('Stop not found or does not belong to this trip'))),
      );
    });

    test('Throws fallback message when stop update error is not JSON', () async {
      final mockHttp = MockClient((request) async {
        return http.Response('Bad gateway', 502);
      });

      final service = TripService(client: ownedTripClient(), httpClient: mockHttp);

      expect(
        () => service.markStopCompleted(stopId, tripDisplayId),
        throwsA(isA<Exception>().having(
          (e) => e.toString(),
          'message',
          contains('Failed to mark stop completed (502)'),
        )),
      );
    });

    test('Throws exception if driver does not own the trip', () async {
      final client = FakeSupabaseClient(
        auth: mockAuth,
        onFrom: (relation) {
          if (relation == 'trips') {
            // Return null for ownership check
            return FakeSupabaseQueryBuilder(Future.value(null));
          }
          throw UnimplementedError('Table $relation should not be queried');
        },
      );

      final service = TripService(client: client, httpClient: createUnusedHttpClient());

      expect(
        () => service.markStopCompleted(stopId, tripDisplayId),
        throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('Unauthorized access to trip data'))),
      );
    });

  });

  group('TripService.updateOnlineStatus Tests', () {
    test('Successfully updates online status', () async {
      final requests = <http.Request>[];
      final mockHttp = MockClient((request) async {
        requests.add(request);
        return http.Response('{}', 200);
      });

      final client = FakeSupabaseClient(auth: mockAuth, onFrom: (relation) {
        throw UnimplementedError('No Supabase access expected');
      });

      final service = TripService(client: client, httpClient: mockHttp);
      await service.updateOnlineStatus(true);

      expect(requests, hasLength(1));
      expect(requests.first.method, equals('PUT'));
      expect(requests.first.url.path, equals('/api/driver/online'));
      expect(requests.first.body, contains('"is_online":true'));
    });

    test('Throws exception if driver_details update returns null', () async {
      final mockHttp = MockClient((request) async {
        return http.Response(
          '{"error": "Driver profile not found or update failed"}',
          404,
        );
      });

      final client = FakeSupabaseClient(auth: mockAuth, onFrom: (relation) {
        throw UnimplementedError('No Supabase access expected');
      });

      final service = TripService(client: client, httpClient: mockHttp);
      expect(
        () => service.updateOnlineStatus(true),
        throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('Driver profile not found or update failed'))),
      );
    });
  });

  group('TripService.startTrip Tests', () {
    FakeSupabaseClient ownedTripClient() => FakeSupabaseClient(
          auth: mockAuth,
          onFrom: (relation) {
            if (relation == 'trips') {
              return FakeSupabaseQueryBuilder(
                Future.value([{'id': 'trip-id-123'}]),
              );
            }
            throw UnimplementedError('Table $relation not mocked');
          },
        );

    test('Successfully starts a trip by marking first stop as current', () async {
      final requests = <http.Request>[];
      final mockHttp = MockClient((request) async {
        requests.add(request);
        return http.Response('{}', 200);
      });

      final service = TripService(client: ownedTripClient(), httpClient: mockHttp);
      await service.startTrip(tripDisplayId);

      expect(requests, hasLength(1));
      expect(requests.first.method, equals('PUT'));
      expect(requests.first.url.path, equals('/api/trips/$tripDisplayId/start'));
    });

    test('Throws exception if startTrip finds no active stops', () async {
      final mockHttp = MockClient((request) async {
        return http.Response(
          '{"error": "No active stops found for this trip"}',
          404,
        );
      });

      final service = TripService(client: ownedTripClient(), httpClient: mockHttp);
      expect(
        () => service.startTrip(tripDisplayId),
        throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('No active stops found for this trip'))),
      );
    });
  });
}
