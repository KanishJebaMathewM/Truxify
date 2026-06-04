import 'package:flutter_test/flutter_test.dart';

import 'package:truxify/core/offline/gps/gps_delta_compressor.dart';

void main() {
  group('GpsDeltaCompressor', () {
    test('flushes a point when distance threshold is exceeded', () {
      final compressor = GpsDeltaCompressor();

      final first = const GpsPoint(latitude: 12.0, longitude: 77.0, timestampMs: 0);
      final second = const GpsPoint(latitude: 12.0003, longitude: 77.0, timestampMs: 30000);

      expect(compressor.add(first), isEmpty);
      final batch = compressor.add(second);

      expect(batch, hasLength(1));
      expect(batch.first.points, hasLength(2));
      expect(batch.first.points.first, first);
      expect(batch.first.points.last, second);
    });

    test('flushes buffered points on timer expiry', () async {
      final compressor = GpsDeltaCompressor(flushInterval: const Duration(milliseconds: 10));
      final first = const GpsPoint(latitude: 12.0, longitude: 77.0, timestampMs: 0);

      expect(compressor.add(first), isEmpty);
      await Future<void>.delayed(const Duration(milliseconds: 30));

      final batch = compressor.drain();
      expect(batch, isNotEmpty);
      expect(batch.first.points, hasLength(1));
    });
  });
}
