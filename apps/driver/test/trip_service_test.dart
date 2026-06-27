import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
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
    test('Successfully completes stop and sets next stop as current', () async {
      final updatedStops = <Map<dynamic, dynamic>>[];
      final updatedTrips = <Map<dynamic, dynamic>>[];
      final eqParams = <String, dynamic>{};
      int tripStopsCallCount = 0;

      final client = FakeSupabaseClient(
        auth: mockAuth,
        onFrom: (relation) {
          if (relation == 'trips') {
            return FakeSupabaseQueryBuilder(
              Future.value([{'id': 'trip-id-123'}]),
              onUpdate: (values) => updatedTrips.add(values),
              onEq: (col, val) => eqParams[col] = val,
            );
          } else if (relation == 'trip_stops') {
            tripStopsCallCount++;
            if (tripStopsCallCount == 1) {
              return FakeSupabaseQueryBuilder(
                Future.value([{'id': stopId}]),
                onUpdate: (values) => updatedStops.add(values),
                onEq: (col, val) => eqParams[col] = val,
              );
            } else if (tripStopsCallCount == 2) {
              return FakeSupabaseQueryBuilder(
                Future.value([
                  {'id': 'next-stop-abc', 'sort_order': 2}
                ]),
                onUpdate: (values) => updatedStops.add(values),
                onEq: (col, val) => eqParams[col] = val,
              );
            } else {
              return FakeSupabaseQueryBuilder(
                Future.value([{'id': 'next-stop-abc'}]),
                onUpdate: (values) => updatedStops.add(values),
                onEq: (col, val) => eqParams[col] = val,
              );
            }
          }
          throw UnimplementedError('Table $relation not mocked');
        },
      );

      final service = TripService(client: client, httpClient: createUnusedHttpClient());

      await service.markStopCompleted(stopId, tripDisplayId);

      // Verify that the stop was completed
      expect(updatedStops.any((s) => s['is_completed'] == true && s['is_current'] == false), isTrue);
      // Verify that next stop was set as current
      expect(updatedStops.any((s) => s['is_current'] == true), isTrue);
      expect(eqParams['id'], equals('next-stop-abc')); // The last eq call was on the next stop
    });

    test('Successfully completes last stop and completes the trip', () async {
      final updatedStops = <Map<dynamic, dynamic>>[];
      final updatedTrips = <Map<dynamic, dynamic>>[];
      final eqParams = <String, dynamic>{};
      int tripStopsCallCount = 0;

      final client = FakeSupabaseClient(
        auth: mockAuth,
        onFrom: (relation) {
          if (relation == 'trips') {
            return FakeSupabaseQueryBuilder(
              Future.value([{'id': 'trip-id-123'}]),
              onUpdate: (values) => updatedTrips.add(values),
              onEq: (col, val) => eqParams[col] = val,
            );
          } else if (relation == 'trip_stops') {
            tripStopsCallCount++;
            if (tripStopsCallCount == 1) {
              return FakeSupabaseQueryBuilder(
                Future.value([{'id': stopId}]),
                onUpdate: (values) => updatedStops.add(values),
                onEq: (col, val) => eqParams[col] = val,
              );
            } else {
              // No next stops (empty list returned)
              return FakeSupabaseQueryBuilder(
                Future.value(<Map<String, dynamic>>[]),
                onUpdate: (values) => updatedStops.add(values),
                onEq: (col, val) => eqParams[col] = val,
              );
            }
          }
          throw UnimplementedError('Table $relation not mocked');
        },
      );

      final service = TripService(client: client, httpClient: createUnusedHttpClient());

      await service.markStopCompleted(stopId, tripDisplayId);

      // Verify that the stop was completed
      expect(updatedStops.any((s) => s['is_completed'] == true && s['is_current'] == false), isTrue);
      // Verify that the trip was marked completed
      expect(updatedTrips.any((t) => t['status'] == 'completed'), isTrue);
    });

    test('Throws exception if stop update returns null (invalid stop ID or not belonging to trip)', () async {
      final updatedStops = <Map<dynamic, dynamic>>[];
      final updatedTrips = <Map<dynamic, dynamic>>[];
      bool tripsQueryChecked = false;

      final client = FakeSupabaseClient(
        auth: mockAuth,
        onFrom: (relation) {
          if (relation == 'trips') {
            tripsQueryChecked = true;
            return FakeSupabaseQueryBuilder(
              Future.value([{'id': 'trip-id-123'}]),
              onUpdate: (values) => updatedTrips.add(values),
            );
          } else if (relation == 'trip_stops') {
            // Return empty list so update returns null after maybeSingle()
            return FakeSupabaseQueryBuilder(
              Future.value(<Map<String, dynamic>>[]),
              onUpdate: (values) => updatedStops.add(values),
            );
          }
          throw UnimplementedError('Table $relation not mocked');
        },
      );

      final service = TripService(client: client, httpClient: createUnusedHttpClient());

      expect(
        () => service.markStopCompleted(stopId, tripDisplayId),
        throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('Stop not found or does not belong to this trip'))),
      );

      // Give async tasks a moment to make sure no updates happened
      await Future.delayed(Duration.zero);

      // Verify that ownership was checked
      expect(tripsQueryChecked, isTrue);
      // Verify that the stop was NOT completed/advanced further (no next stops queried/updated)
      expect(updatedStops.length, equals(1)); // Only the initial update call was made
      expect(updatedTrips.isEmpty, isTrue); // Trip not completed
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
      final updatedDetails = <Map<dynamic, dynamic>>[];
      final eqParams = <String, dynamic>{};

      final client = FakeSupabaseClient(
        auth: mockAuth,
        onFrom: (relation) {
          if (relation == 'driver_details') {
            return FakeSupabaseQueryBuilder(
              Future.value([{'user_id': driverId}]),
              onUpdate: (values) => updatedDetails.add(values),
              onEq: (col, val) => eqParams[col] = val,
            );
          }
          throw UnimplementedError('Table $relation not mocked');
        },
      );

      final service = TripService(client: client, httpClient: createUnusedHttpClient());
      await service.updateOnlineStatus(true);

      expect(eqParams['user_id'], equals(driverId));
      expect(updatedDetails.first['is_online'], isTrue);
      expect(updatedDetails.first['updated_at'], isNotNull);
    });

    test('Throws exception if driver_details update returns null', () async {
      final client = FakeSupabaseClient(
        auth: mockAuth,
        onFrom: (relation) {
          if (relation == 'driver_details') {
            return FakeSupabaseQueryBuilder(
              Future.value(<Map<String, dynamic>>[]),
            );
          }
          throw UnimplementedError('Table $relation not mocked');
        },
      );

      final service = TripService(client: client, httpClient: createUnusedHttpClient());
      expect(
        () => service.updateOnlineStatus(true),
        throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('Driver profile not found or update failed'))),
      );
    });
  });

  group('TripService.startTrip Tests', () {
    test('Successfully starts a trip by marking first stop as current', () async {
      final updatedStops = <Map<dynamic, dynamic>>[];
      final eqParams = <String, dynamic>{};
      int tripStopsCallCount = 0;

      final client = FakeSupabaseClient(
        auth: mockAuth,
        onFrom: (relation) {
          if (relation == 'trips') {
            return FakeSupabaseQueryBuilder(
              Future.value([{'id': 'trip-id-123'}]),
              onEq: (col, val) => eqParams[col] = val,
            );
          } else if (relation == 'trip_stops') {
            tripStopsCallCount++;
            if (tripStopsCallCount == 1) {
              // Fetch first stop
              return FakeSupabaseQueryBuilder(
                Future.value([{'id': stopId, 'sort_order': 1}]),
                onEq: (col, val) => eqParams[col] = val,
              );
            } else {
              // Update stop
              return FakeSupabaseQueryBuilder(
                Future.value([{'id': stopId}]),
                onUpdate: (values) => updatedStops.add(values),
                onEq: (col, val) => eqParams[col] = val,
              );
            }
          }
          throw UnimplementedError('Table $relation not mocked');
        },
      );

      final service = TripService(client: client, httpClient: createUnusedHttpClient());
      await service.startTrip(tripDisplayId);

      expect(updatedStops.first['is_current'], isTrue);
      expect(eqParams['trip_display_id'], equals(tripDisplayId));
    });

    test('Throws exception if startTrip finds no active stops', () async {
      final client = FakeSupabaseClient(
        auth: mockAuth,
        onFrom: (relation) {
          if (relation == 'trips') {
            return FakeSupabaseQueryBuilder(
              Future.value([{'id': 'trip-id-123'}]),
            );
          } else if (relation == 'trip_stops') {
            return FakeSupabaseQueryBuilder(
              Future.value(<Map<String, dynamic>>[]),
            );
          }
          throw UnimplementedError('Table $relation not mocked');
        },
      );

      final service = TripService(client: client, httpClient: createUnusedHttpClient());
      expect(
        () => service.startTrip(tripDisplayId),
        throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('No active stops found for this trip'))),
      );
    });
  });
}
