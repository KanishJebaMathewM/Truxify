import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/app_models.dart';

void main() {
  group('LoadOffer raw data fields', () {
    test('hasDeadheadData returns true when all required fields are present', () {
      const load = LoadOffer(
        route: 'A → B',
        customer: 'C',
        company: 'Co',
        goods: 'G',
        pickup: 'P',
        distanceFromDriver: '10 km',
        estimatedProfit: '₹1000',
        fuelCost: '₹100',
        tollCost: '₹50',
        capacityUsed: 0.5,
        truckFillLabel: '50%',
        sharingTruckWith: '—',
        badgeLabel: 'Available',
        badgeEmoji: '📦',
        routeDistance: '100 km',
        routeDuration: '2h',
        weight: '5 tonnes',
        dimensions: '10 × 5 × 5',
        stackable: 'Yes',
        fragile: 'No',
        specialHandling: '',
        freightValue: '₹1000',
        netProfit: '₹800',
        routeNote: '',
        extraDistance: 0,
        extraEarnings: '₹0',
        spaceAvailable: '50%',
        updatedTotalEarnings: '₹800',
        originLat: 23.0,
        originLng: 72.0,
        destinationLat: 26.0,
        destinationLng: 75.0,
        weightKg: 5000,
        paymentInr: 10000,
      );
      expect(load.hasDeadheadData, isTrue);
    });

    test('hasDeadheadData returns false when originLat is null', () {
      const load = LoadOffer(
        route: 'A → B',
        customer: 'C',
        company: 'Co',
        goods: 'G',
        pickup: 'P',
        distanceFromDriver: '10 km',
        estimatedProfit: '₹1000',
        fuelCost: '₹100',
        tollCost: '₹50',
        capacityUsed: 0.5,
        truckFillLabel: '50%',
        sharingTruckWith: '—',
        badgeLabel: 'Available',
        badgeEmoji: '📦',
        routeDistance: '100 km',
        routeDuration: '2h',
        weight: '5 tonnes',
        dimensions: '10 × 5 × 5',
        stackable: 'Yes',
        fragile: 'No',
        specialHandling: '',
        freightValue: '₹1000',
        netProfit: '₹800',
        routeNote: '',
        extraDistance: 0,
        extraEarnings: '₹0',
        spaceAvailable: '50%',
        updatedTotalEarnings: '₹800',
        destinationLat: 26.0,
        destinationLng: 75.0,
        weightKg: 5000,
        paymentInr: 10000,
      );
      expect(load.hasDeadheadData, isFalse);
    });

    test('hasDeadheadData returns false when paymentInr is null', () {
      const load = LoadOffer(
        route: 'A → B',
        customer: 'C',
        company: 'Co',
        goods: 'G',
        pickup: 'P',
        distanceFromDriver: '10 km',
        estimatedProfit: '₹1000',
        fuelCost: '₹100',
        tollCost: '₹50',
        capacityUsed: 0.5,
        truckFillLabel: '50%',
        sharingTruckWith: '—',
        badgeLabel: 'Available',
        badgeEmoji: '📦',
        routeDistance: '100 km',
        routeDuration: '2h',
        weight: '5 tonnes',
        dimensions: '10 × 5 × 5',
        stackable: 'Yes',
        fragile: 'No',
        specialHandling: '',
        freightValue: '₹1000',
        netProfit: '₹800',
        routeNote: '',
        extraDistance: 0,
        extraEarnings: '₹0',
        spaceAvailable: '50%',
        updatedTotalEarnings: '₹800',
        originLat: 23.0,
        originLng: 72.0,
        destinationLat: 26.0,
        destinationLng: 75.0,
        weightKg: 5000,
      );
      expect(load.hasDeadheadData, isFalse);
    });

    test('hasDeadheadData returns false when no raw data fields provided', () {
      const load = LoadOffer(
        route: 'A → B',
        customer: 'C',
        company: 'Co',
        goods: 'G',
        pickup: 'P',
        distanceFromDriver: '10 km',
        estimatedProfit: '₹1000',
        fuelCost: '₹100',
        tollCost: '₹50',
        capacityUsed: 0.5,
        truckFillLabel: '50%',
        sharingTruckWith: '—',
        badgeLabel: 'Available',
        badgeEmoji: '📦',
        routeDistance: '100 km',
        routeDuration: '2h',
        weight: '5 tonnes',
        dimensions: '10 × 5 × 5',
        stackable: 'Yes',
        fragile: 'No',
        specialHandling: '',
        freightValue: '₹1000',
        netProfit: '₹800',
        routeNote: '',
        extraDistance: 0,
        extraEarnings: '₹0',
        spaceAvailable: '50%',
        updatedTotalEarnings: '₹800',
      );
      expect(load.hasDeadheadData, isFalse);
    });

    test('raw data fields default to null for backward compatibility', () {
      const load = LoadOffer(
        route: 'A → B',
        customer: 'C',
        company: 'Co',
        goods: 'G',
        pickup: 'P',
        distanceFromDriver: '10 km',
        estimatedProfit: '₹1000',
        fuelCost: '₹100',
        tollCost: '₹50',
        capacityUsed: 0.5,
        truckFillLabel: '50%',
        sharingTruckWith: '—',
        badgeLabel: 'Available',
        badgeEmoji: '📦',
        routeDistance: '100 km',
        routeDuration: '2h',
        weight: '5 tonnes',
        dimensions: '10 × 5 × 5',
        stackable: 'Yes',
        fragile: 'No',
        specialHandling: '',
        freightValue: '₹1000',
        netProfit: '₹800',
        routeNote: '',
        extraDistance: 0,
        extraEarnings: '₹0',
        spaceAvailable: '50%',
        updatedTotalEarnings: '₹800',
      );
      expect(load.originLat, isNull);
      expect(load.originLng, isNull);
      expect(load.destinationLat, isNull);
      expect(load.destinationLng, isNull);
      expect(load.weightKg, isNull);
      expect(load.lengthM, isNull);
      expect(load.widthM, isNull);
      expect(load.heightM, isNull);
      expect(load.paymentInr, isNull);
    });

    test('raw data fields store correct values when provided', () {
      const load = LoadOffer(
        route: 'Surat → Jaipur',
        customer: 'Raj',
        company: 'Raj Traders',
        goods: 'Textile',
        pickup: 'Surat',
        distanceFromDriver: '20 km',
        estimatedProfit: '₹3000',
        fuelCost: '₹500',
        tollCost: '₹200',
        capacityUsed: 0.4,
        truckFillLabel: '40%',
        sharingTruckWith: '—',
        badgeLabel: 'Best Profit',
        badgeEmoji: '💰',
        routeDistance: '431 km',
        routeDuration: '7.1h',
        weight: '6 tonnes',
        dimensions: '13 × 6 × 6',
        stackable: 'No',
        fragile: 'Yes',
        specialHandling: '',
        freightValue: '₹8220',
        netProfit: '₹6100',
        routeNote: '',
        extraDistance: 0,
        extraEarnings: '₹0',
        spaceAvailable: '60%',
        updatedTotalEarnings: '₹6100',
        originLat: 21.1702,
        originLng: 72.8311,
        destinationLat: 26.9124,
        destinationLng: 75.7873,
        weightKg: 6000,
        lengthM: 4.0,
        widthM: 1.8,
        heightM: 1.8,
        paymentInr: 8220,
      );
      expect(load.originLat, 21.1702);
      expect(load.originLng, 72.8311);
      expect(load.destinationLat, 26.9124);
      expect(load.destinationLng, 75.7873);
      expect(load.weightKg, 6000);
      expect(load.lengthM, 4.0);
      expect(load.widthM, 1.8);
      expect(load.heightM, 1.8);
      expect(load.paymentInr, 8220);
    });
  });

  group('LoadOffer hasDeadheadData edge cases', () {
    test('returns false when weightKg is null but all others present', () {
      const load = LoadOffer(
        route: 'A → B',
        customer: 'C',
        company: 'Co',
        goods: 'G',
        pickup: 'P',
        distanceFromDriver: '10 km',
        estimatedProfit: '₹1000',
        fuelCost: '₹100',
        tollCost: '₹50',
        capacityUsed: 0.5,
        truckFillLabel: '50%',
        sharingTruckWith: '—',
        badgeLabel: 'Available',
        badgeEmoji: '📦',
        routeDistance: '100 km',
        routeDuration: '2h',
        weight: '5 tonnes',
        dimensions: '10 × 5 × 5',
        stackable: 'Yes',
        fragile: 'No',
        specialHandling: '',
        freightValue: '₹1000',
        netProfit: '₹800',
        routeNote: '',
        extraDistance: 0,
        extraEarnings: '₹0',
        spaceAvailable: '50%',
        updatedTotalEarnings: '₹800',
        originLat: 23.0,
        originLng: 72.0,
        destinationLat: 26.0,
        destinationLng: 75.0,
        paymentInr: 10000,
      );
      expect(load.hasDeadheadData, isTrue);
    });
  });
}
