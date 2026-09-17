import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/fuel_analytics_service.dart';
import 'package:truxify_driver/services/trip_service.dart';

class FakeTripService extends TripService {
  FakeTripService(this.trips);

  final List<Map<String, dynamic>> trips;
  String? lastStatus;

  @override
  Future<List<Map<String, dynamic>>> fetchTrips({String? status}) async {
    lastStatus = status;
    return trips;
  }
}

void main() {
  group('FuelAnalyticsService', () {
    test('completed-trips filter is passed to trip service', () async {
      final fakeService = FakeTripService([]);
      final fuelService = FuelAnalyticsService(tripService: fakeService);

      await fuelService.calculateAnalytics(10.0);

      expect(fakeService.lastStatus, 'completed');
    });

    test('aggregation over an empty trip list returns all-zero results', () async {
      final fakeService = FakeTripService([]);
      final fuelService = FuelAnalyticsService(tripService: fakeService);

      final result = await fuelService.calculateAnalytics(10.0);

      expect(result['totalPayout'], 0.0);
      expect(result['estimatedFuelCost'], 0.0);
      expect(result['profitMargin'], 0.0);
      expect(result['chartPoints'], isEmpty);
    });

    test('correct distance, payout, and fuel totals for a sample trip list', () async {
      final sampleTrips = [
        {
          'id': 'trip-1',
          'distance': '100 km',
          'earnings': 500000, // 5,000 INR
          'date': '2026-06-01',
        },
        {
          'id': 'trip-2',
          'distance': '150 km',
          'earnings': 750000, // 7,500 INR
          'date': '2026-06-02',
        },
      ];

      final fakeService = FakeTripService(sampleTrips);
      final fuelService = FuelAnalyticsService(tripService: fakeService);

      // averageMpg = 10.0
      // kmPerLitre = 10.0 * 1.60934 / 3.78541 = 4.2514285...
      // totalDistance = 250 km
      // fuelLitresUsed = 250 / 4.2514285... = 58.80376...
      // estimatedFuelCost = 58.80376... * 90.0 = 5292.3389...
      // totalPayout = (500000 + 750000) / 100 = 12500 INR
      // profitMargin = ((12500 - 5292.3389...) / 12500) * 100 = 57.6612... %
      final result = await fuelService.calculateAnalytics(10.0);

      expect(result['totalPayout'], 12500.0);
      expect(result['estimatedFuelCost'], closeTo(5292.34, 0.5));
      expect(result['profitMargin'], closeTo(57.66, 0.5));

      final chartPoints = result['chartPoints'] as List;
      expect(chartPoints, hasLength(2));
      // chartPoints are reversed (trip-2 then trip-1)
      expect(chartPoints[0]['label'], '2026-06-02');
      expect(chartPoints[0]['payout'], 7500.0);
      expect(chartPoints[1]['label'], '2026-06-01');
      expect(chartPoints[1]['payout'], 5000.0);
    });

    test('handles edge cases (null, missing, non-numeric, and zero fields)', () async {
      final edgeCaseTrips = [
        {
          'id': 'trip-null-fields',
          'distance': null,
          'earnings': null,
          'date': null,
        },
        {
          'id': 'trip-zero-fields',
          'distance': '0 km',
          'earnings': 0,
        },
        {
          'id': 'trip-dirty-strings',
          'distance': 'approx ~ 50.5 kilometers',
          'earnings': '₹ 2,000.00 paisa',
        },
      ];

      final fakeService = FakeTripService(edgeCaseTrips);
      final fuelService = FuelAnalyticsService(tripService: fakeService);

      final result = await fuelService.calculateAnalytics(0.0); // 0 MPG edge case

      expect(result['totalPayout'], isNotNull);
      expect(result['estimatedFuelCost'], 0.0);
      expect(result['profitMargin'], 0.0);
      expect(result['chartPoints'], hasLength(3));
      expect((result['chartPoints'] as List).last['label'], 'Trip');
    });

    test('limits chart points to the last 5 trips in reverse chronological order', () async {
      final sixTrips = List.generate(
        6,
        (i) => {
          'id': 'trip-${i + 1}',
          'distance': '10 km',
          'earnings': 10000,
          'date': '2026-06-0${i + 1}',
        },
      );

      final fakeService = FakeTripService(sixTrips);
      final fuelService = FuelAnalyticsService(tripService: fakeService);

      final result = await fuelService.calculateAnalytics(10.0);
      final chartPoints = result['chartPoints'] as List;

      expect(chartPoints, hasLength(5));
      expect(chartPoints.first['label'], '2026-06-06');
      expect(chartPoints.last['label'], '2026-06-02');
    });

    test('propagates exception when trip service fetch fails', () async {
      final tripService = TripService();
      // Unauthenticated client throws when fetching
      final fuelService = FuelAnalyticsService(tripService: tripService);

      expect(
        () => fuelService.calculateAnalytics(10.0),
        throwsA(isA<Exception>()),
      );
    });
  });
}
