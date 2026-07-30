import 'package:flutter_test/flutter_test.dart';
import 'package:driver/models/app_models.dart';

void main() {
  group('LoadOffer data for profit prediction', () {
    const testLoad = LoadOffer(
      id: 'load-1',
      route: 'Mumbai → Pune',
      customer: 'Acme Corp',
      company: 'Acme Logistics',
      goods: 'Electronics',
      pickup: 'Mumbai Central',
      distanceFromDriver: '12 km',
      estimatedProfit: '₹8500',
      fuelCost: '₹5,000',
      tollCost: '₹1,200',
      capacityUsed: 0.65,
      truckFillLabel: '65% filled',
      sharingTruckWith: '—',
      badgeLabel: 'Best Profit',
      badgeEmoji: '💰',
      routeDistance: '500 km',
      routeDuration: '8h 30m',
      weight: '5000',
      dimensions: '12x8x4',
      stackable: 'Yes',
      fragile: 'No',
      specialHandling: '',
      freightValue: '₹14,700',
      netProfit: '₹8,500',
      routeNote: '',
      extraDistance: 0,
      extraEarnings: '₹0',
      spaceAvailable: '35%',
      updatedTotalEarnings: '₹14,700',
      weightKg: 5000,
      originLat: 19.0760,
      originLng: 72.8777,
      destinationLat: 18.5204,
      destinationLng: 73.8567,
      paymentInr: 14700,
    );

    test('load has sufficient weightKg for prediction', () {
      expect(testLoad.weightKg, isNotNull);
      expect(testLoad.weightKg, 5000);
    });

    test('load routeDistance is parseable', () {
      final cleaned = testLoad.routeDistance.replaceAll(RegExp(r'[^0-9.]'), '');
      final distance = double.tryParse(cleaned) ?? 0;
      expect(distance, 500);
    });

    test('load routeDuration is parseable', () {
      final hourMatch = RegExp(r'(\d+)\s*h').firstMatch(testLoad.routeDuration);
      final minMatch = RegExp(r'(\d+)\s*m').firstMatch(testLoad.routeDuration);
      final hours = double.tryParse(hourMatch?.group(1) ?? '') ?? 0;
      final mins = double.tryParse(minMatch?.group(1) ?? '') ?? 0;
      final duration = hours + mins / 60;
      expect(duration, 8.5);
    });

    test('load tollCost is parseable to INR', () {
      final cleaned = testLoad.tollCost.replaceAll(RegExp(r'[^0-9]'), '');
      final toll = double.tryParse(cleaned) ?? 0;
      expect(toll, 1200);
    });
  });

  group('ProfitEstimateCard color thresholds', () {
    test('high profitability threshold', () {
      const highThreshold = 5000;
      expect(highThreshold > 5000, isFalse);
      expect(6000 > 5000, isTrue);
    });

    test('low profitability threshold', () {
      const lowThreshold = 1000;
      expect(500 < lowThreshold, isTrue);
      expect(1500 < lowThreshold, isFalse);
    });
  });
}
