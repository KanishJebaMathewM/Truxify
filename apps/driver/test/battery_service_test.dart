import 'package:battery_plus/battery_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/battery_service.dart';

void main() {
  group('BatteryInfo', () {
    test('isLow returns true when level is 20 or below', () {
      expect(const BatteryInfo(level: 20, isCharging: false).isLow, isTrue);
      expect(const BatteryInfo(level: 15, isCharging: false).isLow, isTrue);
      expect(const BatteryInfo(level: 10, isCharging: false).isLow, isTrue);
      expect(const BatteryInfo(level: 21, isCharging: false).isLow, isFalse);
    });

    test('isCritical returns true when level is 10 or below', () {
      expect(const BatteryInfo(level: 10, isCharging: false).isCritical, isTrue);
      expect(const BatteryInfo(level: 5, isCharging: false).isCritical, isTrue);
      expect(const BatteryInfo(level: 11, isCharging: false).isCritical, isFalse);
    });

    test('equality works correctly', () {
      const a = BatteryInfo(level: 75, isCharging: true);
      const b = BatteryInfo(level: 75, isCharging: true);
      const c = BatteryInfo(level: 75, isCharging: false);
      const d = BatteryInfo(level: 80, isCharging: true);

      expect(a, equals(b));
      expect(a == c, isFalse);
      expect(a == d, isFalse);
      expect(a.hashCode, equals(b.hashCode));
    });
  });

  group('BatteryService', () {
    test('singleton returns same instance', () {
      final a = BatteryService.instance;
      final b = BatteryService.instance;
      expect(identical(a, b), isTrue);
    });

    test('initial state is default values', () {
      final service = BatteryService.instance;
      expect(service.batteryLevel, 100);
      expect(service.isCharging, isFalse);
      expect(service.isLow, isFalse);
      expect(service.isCritical, isFalse);
      expect(service.isMonitoring, isFalse);
    });

    test('startMonitoring sets isMonitoring to true', () async {
      final service = BatteryService.instance;
      await service.startMonitoring();
      expect(service.isMonitoring, isTrue);
      service.stopMonitoring();
    });

    test('stopMonitoring sets isMonitoring to false', () async {
      final service = BatteryService.instance;
      await service.startMonitoring();
      service.stopMonitoring();
      expect(service.isMonitoring, isFalse);
    });

    test('stopMonitoring is idempotent', () {
      final service = BatteryService.instance;
      service.stopMonitoring();
      service.stopMonitoring();
      expect(service.isMonitoring, isFalse);
    });

    test('currentInfo provides level and charging state', () {
      final service = BatteryService.instance;
      final info = service.currentInfo;
      expect(info.level, greaterThanOrEqualTo(0));
      expect(info.level, lessThanOrEqualTo(100));
      expect(info.isCharging, isA<bool>());
    });
  });
}
