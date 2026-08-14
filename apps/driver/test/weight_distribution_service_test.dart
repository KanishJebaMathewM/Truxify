import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/weight_distribution_service.dart';

void main() {
  group('WeightDistributionService.updatePalletPosition', () {
    test('updates the position of a known pallet', () async {
      final service = WeightDistributionService();
      service.initializeSimulation();

      final emitted = <double>[];
      final sub = service.weightStream.listen((s) {
        for (final p in s.pallets) {
          if (p.id == 'P1 (Steel)') emitted.add(p.positionX);
        }
      });
      service.updatePalletPosition('P1 (Steel)', 0.2);
      await Future<void>.delayed(Duration.zero);
      sub.cancel();
      service.dispose();

      expect(emitted.last, closeTo(0.2, 1e-9));
    });

    test('does not throw for an unknown pallet id', () {
      final service = WeightDistributionService();
      service.initializeSimulation();

      expect(() => service.updatePalletPosition('NO-SUCH-PALLET', 0.9),
          returnsNormally);
      service.dispose();
    });
  });
}
