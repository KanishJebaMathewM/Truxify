import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:truxify/utils/location_permission_helper.dart';

void main() {
  group('LocationPermissionHelper Unit Tests', () {
    test('LocationPermissionResult holds values correctly on success', () {
      final position = Position(
        longitude: 72.8777,
        latitude: 19.0760,
        timestamp: DateTime.now(),
        accuracy: 10.0,
        altitude: 0.0,
        altitudeAccuracy: 0.0,
        heading: 0.0,
        headingAccuracy: 0.0,
        speed: 0.0,
        speedAccuracy: 0.0,
      );

      final result = LocationPermissionResult(
        isGranted: true,
        canProceed: true,
        position: position,
      );

      expect(result.isGranted, isTrue);
      expect(result.canProceed, isTrue);
      expect(result.position?.latitude, equals(19.0760));
      expect(result.position?.longitude, equals(72.8777));
      expect(result.errorMessage, isNull);
    });

    test('LocationPermissionResult holds error message on denial without crash', () {
      const result = LocationPermissionResult(
        isGranted: false,
        canProceed: true,
        errorMessage: 'Location permission denied. Please enter address manually.',
      );

      expect(result.isGranted, isFalse);
      expect(result.canProceed, isTrue);
      expect(result.position, isNull);
      expect(result.errorMessage, contains('denied'));
    });
  });
}
