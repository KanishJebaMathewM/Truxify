import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/truck_models.dart';

void main() {
  group('Truck.fromJson', () {
    test('does not crash on null/absent string fields', () {
      final truck = Truck.fromJson({
        'id': null,
        'driver_id': null,
        'name': null,
        'number_plate': null,
      });
      expect(truck.id, '');
      expect(truck.driverId, '');
      expect(truck.name, '');
      expect(truck.numberPlate, '');
    });

    test('coerces non-string numeric fields to String', () {
      final truck = Truck.fromJson({
        'id': 42,
        'driver_id': 7,
        'name': 'Truck A',
        'number_plate': 'MH01AB1234',
      });
      expect(truck.id, '42');
      expect(truck.driverId, '7');
      expect(truck.name, 'Truck A');
    });

    test('parses numeric fields with type guards', () {
      final truck = Truck.fromJson({
        'id': '1',
        'driver_id': 'd1',
        'name': 'Truck',
        'number_plate': 'NP',
        'max_capacity_tons': '12.5',
        'average_mpg': 8,
      });
      expect(truck.maxCapacityTons, 12.5);
      expect(truck.averageMpg, 8.0);
    });
  });
}
