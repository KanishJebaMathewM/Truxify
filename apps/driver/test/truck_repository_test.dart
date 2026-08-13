import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_driver/models/truck_models.dart';
import 'package:truxify_driver/services/truck_repository.dart';

class MockGoTrueClient implements GoTrueClient {
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
    if (invocation.memberName == #single) {
      return FakePostgrestTransformBuilder<Map<String, dynamic>>(_futureValue.then((val) {
        if (val is List && val.isNotEmpty) {
          return val.first as Map<String, dynamic>;
        }
        return val as Map<String, dynamic>;
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
  final Function(Map)? onUpdate;

  FakePostgrestFilterBuilder(this._futureValue, {this.onEq, this.onUpdate});

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #eq) {
      final String col = invocation.positionalArguments[0] as String;
      final Object val = invocation.positionalArguments[1];
      onEq?.call(col, val);
      return this;
    }
    if (invocation.memberName == #order) {
      return this;
    }
    if (invocation.memberName == #update) {
      final Map values = invocation.positionalArguments.first as Map;
      onUpdate?.call(values);
      return FakePostgrestTransformBuilder<List<Map<String, dynamic>>>(_futureValue);
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
      return FakePostgrestFilterBuilder<List<Map<String, dynamic>>>(_futureValue, onEq: onEq, onUpdate: onUpdate);
    }
    if (invocation.memberName == #update) {
      final Map values = invocation.positionalArguments.first as Map;
      onUpdate?.call(values);
      return FakePostgrestFilterBuilder<List<Map<String, dynamic>>>(_futureValue, onEq: onEq);
    }
    if (invocation.memberName == #insert) {
      final Map values = invocation.positionalArguments.first as Map;
      onUpdate?.call(values);
      return FakePostgrestFilterBuilder<List<Map<String, dynamic>>>(_futureValue, onEq: onEq);
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
  const driverId = 'driver-123';
  const truckJson = <String, dynamic>{
    'id': 'truck-1',
    'driver_id': 'driver-123',
    'name': 'MH 12 AB 1234',
    'number_plate': 'MH 12 AB 1234',
    'max_capacity_tons': 10.0,
    'average_mpg': 6.5,
    'insurance_expiry': '2026-01-01T00:00:00.000Z',
    'puc_expiry': '2026-02-01T00:00:00.000Z',
    'permit_expiry': '2026-03-01T00:00:00.000Z',
    'cargo_length_ft': 20.0,
    'cargo_width_ft': 8.0,
    'cargo_height_ft': 8.5,
  };

  FakeSupabaseClient truckClient(Future<dynamic> future) {
    return FakeSupabaseClient(
      onFrom: (relation) {
        expect(relation, 'trucks');
        return FakeSupabaseQueryBuilder(future);
      },
    );
  }

  group('TruckRepository.fetchTruckForDriver', () {
    test('returns parsed Truck on success', () async {
      final repository = TruckRepository(client: truckClient(Future.value([truckJson])));

      final truck = await repository.fetchTruckForDriver(driverId);

      expect(truck, isNotNull);
      expect(truck!.id, 'truck-1');
      expect(truck.driverId, 'driver-123');
      expect(truck.name, 'MH 12 AB 1234');
      expect(truck.numberPlate, 'MH 12 AB 1234');
      expect(truck.maxCapacityTons, 10.0);
      expect(truck.averageMpg, 6.5);
      expect(truck.insuranceExpiry, isNotNull);
      expect(truck.pucExpiry, isNotNull);
      expect(truck.permitExpiry, isNotNull);
      expect(truck.cargoLengthFt, 20.0);
      expect(truck.cargoWidthFt, 8.0);
      expect(truck.cargoHeightFt, 8.5);
    });

    test('returns null on empty result', () async {
      final repository = TruckRepository(client: truckClient(Future.value([])));

      final truck = await repository.fetchTruckForDriver(driverId);

      expect(truck, isNull);
    });

    test('returns null on null result', () async {
      final repository = TruckRepository(client: truckClient(Future.value(null)));

      final truck = await repository.fetchTruckForDriver(driverId);

      expect(truck, isNull);
    });

    test('propagates exceptions from the client', () async {
      final repository = TruckRepository(
        client: truckClient(Future.error(Exception('Supabase down'))),
      );

      expect(
        () => repository.fetchTruckForDriver(driverId),
        throwsA(isA<Exception>()),
      );
    });

    test('parses truck with missing optional fields using defaults', () async {
      final repository = TruckRepository(
        client: truckClient(Future.value([
          {'id': 'truck-2', 'driver_id': 'driver-123', 'name': 'Truck', 'number_plate': 'TS 09 XY 5678'},
        ])),
      );

      final truck = await repository.fetchTruckForDriver(driverId);

      expect(truck, isNotNull);
      expect(truck!.maxCapacityTons, 0.0);
      expect(truck.averageMpg, 6.0);
      expect(truck.insuranceExpiry, isNull);
      expect(truck.cargoLengthFt, 0.0);
    });
  });

  group('TruckRepository.fetchMaintenanceTickets', () {
    test('returns parsed tickets on success', () async {
      final client = FakeSupabaseClient(
        onFrom: (relation) {
          expect(relation, 'truck_maintenance_tickets');
          return FakeSupabaseQueryBuilder(Future.value([
            {'id': 1, 'truck_id': 'truck-1', 'driver_id': 'driver-123', 'category': 'engine', 'description': 'Overheating', 'status': 'open', 'created_at': '2025-01-01T00:00:00.000Z'},
            {'id': 2, 'truck_id': 'truck-1', 'driver_id': 'driver-123', 'category': 'tyre', 'description': 'Flat tyre', 'status': 'resolved', 'created_at': '2025-01-02T00:00:00.000Z'},
          ]));
        },
      );

      final repository = TruckRepository(client: client);
      final tickets = await repository.fetchMaintenanceTickets('truck-1');

      expect(tickets, hasLength(2));
      expect(tickets.first.id, '1');
      expect(tickets.first.category, 'engine');
      expect(tickets.first.status, 'open');
      expect(tickets.last.status, 'resolved');
    });

    test('throws on non-list response', () async {
      final repository = TruckRepository(
        client: FakeSupabaseClient(
          onFrom: (relation) => FakeSupabaseQueryBuilder(Future.value({'not': 'a list'})),
        ),
      );

      expect(
        () => repository.fetchMaintenanceTickets('truck-1'),
        throwsA(isA<StateError>()),
      );
    });
  });

  group('TruckRepository.updateTicketStatus', () {
    test('rejects unsupported status', () async {
      final repository = TruckRepository(
        client: FakeSupabaseClient(onFrom: (relation) => throw UnimplementedError()),
      );

      expect(
        () => repository.updateTicketStatus(ticketId: 1, driverId: driverId, status: 'weird'),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('updates status successfully', () async {
      Map? updatedValues;
      final client = FakeSupabaseClient(
        onFrom: (relation) {
          expect(relation, 'truck_maintenance_tickets');
          return FakeSupabaseQueryBuilder(
            Future.value([{'id': 1, 'truck_id': 'truck-1', 'driver_id': 'driver-123', 'category': 'engine', 'description': 'Overheating', 'status': 'resolved'}]),
            onUpdate: (values) => updatedValues = values,
          );
        },
      );

      final repository = TruckRepository(client: client);
      final ticket = await repository.updateTicketStatus(ticketId: 1, driverId: driverId, status: 'RESOLVED');

      expect(ticket, isNotNull);
      expect(ticket!.status, 'resolved');
      expect(updatedValues, isNotNull);
      expect(updatedValues!['status'], 'resolved');
      expect(updatedValues!['resolved_at'], isNotNull);
    });
  });

  group('TruckRepository.updateTruckMileage', () {
    test('returns true when update succeeds', () async {
      final repository = TruckRepository(
        client: truckClient(Future.value([{'id': 'truck-1'}])),
      );

      final success = await repository.updateTruckMileage(truckId: 'truck-1', currentMileage: 12345.0);

      expect(success, isTrue);
    });

    test('returns false when update returns null', () async {
      final repository = TruckRepository(
        client: truckClient(Future.value(null)),
      );

      final success = await repository.updateTruckMileage(truckId: 'truck-1', currentMileage: 12345.0);

      expect(success, isFalse);
    });
  });
}
