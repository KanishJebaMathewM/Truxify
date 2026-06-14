import 'package:flutter_test/flutter_test.dart';

import 'package:truxify/core/offline/conflict/conflict_resolver.dart';
import 'package:truxify/core/offline/models/trip_event.dart';

void main() {
  group('ConflictResolver', () {
    test('keeps the latest GPS update by device timestamp', () {
      final resolver = ConflictResolver();
      final events = <TripEvent>[
        TripEvent.gpsUpdate('trip-1', {'lat': 12.0, 'lng': 77.0}, occurredAt: '2024-01-01T00:00:00.000Z'),
        TripEvent.gpsUpdate('trip-1', {'lat': 12.1, 'lng': 77.1}, occurredAt: '2024-01-01T00:00:02.000Z'),
      ];

      final resolved = resolver.resolve(events);

      expect(resolved, hasLength(1));
      expect(resolved.single.payload['lat'], 12.1);
    });

    test('deduplicates OTP delivery events by trip and stop', () {
      final resolver = ConflictResolver();
      final events = <TripEvent>[
        TripEvent.otpDelivery('trip-1', 'stop-1', occurredAt: '2024-01-01T00:00:00.000Z'),
        TripEvent.otpDelivery('trip-1', 'stop-1', occurredAt: '2024-01-01T00:00:01.000Z'),
      ];

      final resolved = resolver.resolve(events);

      expect(resolved, hasLength(1));
      expect(resolved.single.payload['stopId'], 'stop-1');
    });
  });
}
