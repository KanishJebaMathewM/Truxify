import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/background_tracker.dart';

void main() {
  group('BackgroundTrackerService', () {
    test('round-trips a location ping through the worker isolate', () async {
      final service = BackgroundTrackerService();
      final events = <Map<String, dynamic>>[];
      final sub = service.locationStream.listen(events.add);
      addTearDown(sub.cancel);

      await service.startBackgroundTracking();

      final ping = <String, dynamic>{
        'driverId': 'd1',
        'orderId': 'o1',
        'lat': 12.97,
        'lng': 77.59,
        'speed': 42.0,
        'bearing': 90.0,
      };

      // Re-send until the worker handshake has completed and the payload
      // has been mapped and echoed back on the main isolate.
      for (var i = 0; i < 10 && events.isEmpty; i++) {
        service.processLocationPing(ping);
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }

      service.stopBackgroundTracking();

      expect(events, hasLength(1));
      final e = events.first;
      expect(e['driver_id'], 'd1');
      expect(e['order_id'], 'o1');
      expect(e['lat'], 12.97);
      expect(e['lng'], 77.59);
      expect(e['speed'], 42.0);
      expect(e['bearing'], 90.0);
      expect(e['device_timestamp'], isNotEmpty);
    });

    test('processLocationPing before start is a no-op', () {
      final service = BackgroundTrackerService();

      expect(() => service.processLocationPing({'lat': 1.0}), returnsNormally);
    });

    test('stopBackgroundTracking stops forwarding pings', () async {
      final service = BackgroundTrackerService();
      final events = <Map<String, dynamic>>[];
      final sub = service.locationStream.listen(events.add);
      addTearDown(sub.cancel);

      await service.startBackgroundTracking();
      await Future<void>.delayed(const Duration(milliseconds: 300));

      service.stopBackgroundTracking();
      service.processLocationPing({'lat': 2.0, 'lng': 3.0});
      await Future<void>.delayed(const Duration(milliseconds: 200));

      expect(events, isEmpty);
    });

    test('start→stop→start cycle releases ports and delivers fresh events',
        () async {
      final service = BackgroundTrackerService();
      final events = <Map<String, dynamic>>[];
      final sub = service.locationStream.listen(events.add);
      addTearDown(sub.cancel);

      final ping = <String, dynamic>{
        'driverId': 'd1',
        'orderId': 'o1',
        'lat': 12.97,
        'lng': 77.59,
      };

      // First cycle.
      await service.startBackgroundTracking();
      for (var i = 0; i < 10 && events.length < 1; i++) {
        service.processLocationPing(ping);
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
      service.stopBackgroundTracking();

      // Stop must fully release the prior listener/port so a subsequent
      // start creates a clean cycle without leaking or double-delivering.
      await service.startBackgroundTracking();
      for (var i = 0; i < 10 && events.length < 2; i++) {
        service.processLocationPing(ping);
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
      service.stopBackgroundTracking();

      // Exactly one event per cycle — no duplicate handlers from the leak.
      expect(events, hasLength(2));
    });
  });
}
