import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/utils/driver_utils.dart';

void main() {
  group('DriverUtils Unit Tests', () {
    group('isValidDriverName', () {
      test('returns false for null or empty/whitespace names', () {
        expect(DriverUtils.isValidDriverName(null), isFalse);
        expect(DriverUtils.isValidDriverName(''), isFalse);
        expect(DriverUtils.isValidDriverName('   '), isFalse);
      });

      test('returns false for UUID string format', () {
        expect(
          DriverUtils.isValidDriverName('d1f930e4-5c9b-439d-b8d4-9d54b568779b'),
          isFalse,
        );
        expect(
          DriverUtils.isValidDriverName('D1F930E4-5C9B-439D-B8D4-9D54B568779B'),
          isFalse,
        );
      });

      test('returns true for normal human names', () {
        expect(DriverUtils.isValidDriverName('John Doe'), isTrue);
        expect(DriverUtils.isValidDriverName('Rajesh Kumar'), isTrue);
      });
    });

    group('resolveDriverName', () {
      test('resolves from profiles.full_name first if valid', () {
        final order = {
          'profiles': {'full_name': 'John Doe'},
          'driver_name': 'Jane Smith',
        };
        expect(DriverUtils.resolveDriverName(order), 'John Doe');
      });

      test('ignores profiles.full_name if it is a UUID and uses driver_name instead', () {
        final order = {
          'profiles': {'full_name': 'd1f930e4-5c9b-439d-b8d4-9d54b568779b'},
          'driver_name': 'Jane Smith',
        };
        expect(DriverUtils.resolveDriverName(order), 'Jane Smith');
      });

      test('uses driver_name if profiles.full_name is missing or invalid', () {
        final order = {
          'driver_name': 'Jane Smith',
        };
        expect(DriverUtils.resolveDriverName(order), 'Jane Smith');
      });

      test('ignores driver_name if it is a UUID and profiles is missing', () {
        final order = {
          'driver_name': 'd1f930e4-5c9b-439d-b8d4-9d54b568779b',
        };
        expect(DriverUtils.resolveDriverName(order), 'Driver Assigned');
      });

      test('falls back to "Driver Assigned" if both are missing, empty, or UUIDs', () {
        final order1 = {
          'profiles': {'full_name': 'd1f930e4-5c9b-439d-b8d4-9d54b568779b'},
          'driver_name': '5c9b439d-b8d4-9d54b568779b-d1f930e4',
        };
        expect(DriverUtils.resolveDriverName(order1), 'Driver Assigned');

        final order2 = <String, dynamic>{};
        expect(DriverUtils.resolveDriverName(order2), 'Driver Assigned');
      });
    });
  });
}
