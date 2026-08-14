import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/deadhead_recommendation.dart';

void main() {
  group('DeadheadRecommendation.fromJson', () {
    test('parses JSON numbers', () {
      final rec = DeadheadRecommendation.fromJson(const {
        'load_id': 'L-1',
        'distance_to_pickup_km': 12.5,
        'match_score': 78,
        'detour_km': 3.2,
        'estimated_earnings': 4500,
        'route': 'Surat -> Jaipur',
      });

      expect(rec.loadId, 'L-1');
      expect(rec.distanceToPickupKm, 12.5);
      expect(rec.matchScore, 78);
      expect(rec.detourKm, 3.2);
      expect(rec.estimatedEarnings, 4500);
    });

    test('parses numeric strings emitted by the ML API', () {
      final rec = DeadheadRecommendation.fromJson(const {
        'load_id': 'L-2',
        'distance_to_pickup_km': '18.75',
        'match_score': '91',
        'detour_km': '1.5',
        'estimated_earnings': '6200',
      });

      expect(rec.distanceToPickupKm, 18.75);
      expect(rec.matchScore, 91);
      expect(rec.detourKm, 1.5);
      expect(rec.estimatedEarnings, 6200);
    });

    test('falls back to default on missing or malformed values', () {
      final rec = DeadheadRecommendation.fromJson(const {
        'load_id': 'L-3',
        'match_score': 'not-a-number',
      });

      expect(rec.distanceToPickupKm, 0);
      expect(rec.matchScore, 0);
      expect(rec.route, '');
    });
  });
}
