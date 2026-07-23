import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/app_models.dart';
import 'package:truxify_driver/services/marketplace_repository.dart';

void main() {
  group('MarketplaceRepository.buildDeadheadPayload', () {
    late MarketplaceRepository repository;

    setUp(() {
      repository = MarketplaceRepository(
        apiBaseUrl: 'http://localhost:5000',
      );
    });

    tearDown(() {
      repository.dispose();
    });

    const completeLoad = LoadOffer(
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
      id: 'load-001',
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

    const incompleteLoad = LoadOffer(
      route: 'Mumbai → Delhi',
      customer: 'Kumar',
      company: 'Kumar Exports',
      goods: 'Electronics',
      pickup: 'Mumbai',
      distanceFromDriver: '100 km',
      estimatedProfit: '₹5000',
      fuelCost: '₹800',
      tollCost: '₹300',
      capacityUsed: 0.6,
      truckFillLabel: '60%',
      sharingTruckWith: '—',
      badgeLabel: 'Available',
      badgeEmoji: '📦',
      routeDistance: '1400 km',
      routeDuration: '24h',
      weight: '2 tonnes',
      dimensions: '8 × 4 × 4',
      stackable: 'Yes',
      fragile: 'No',
      specialHandling: '',
      freightValue: '₹5000',
      netProfit: '₹3900',
      routeNote: '',
      extraDistance: 0,
      extraEarnings: '₹0',
      spaceAvailable: '40%',
      updatedTotalEarnings: '₹3900',
      id: 'load-002',
    );

    const partialLoad = LoadOffer(
      route: 'Chennai → Bangalore',
      customer: 'Singh',
      company: 'Singh Logistics',
      goods: 'Auto Parts',
      pickup: 'Chennai',
      distanceFromDriver: '50 km',
      estimatedProfit: '₹1500',
      fuelCost: '₹200',
      tollCost: '₹100',
      capacityUsed: 0.3,
      truckFillLabel: '30%',
      sharingTruckWith: '—',
      badgeLabel: 'Available',
      badgeEmoji: '📦',
      routeDistance: '350 km',
      routeDuration: '6h',
      weight: '1 tonne',
      dimensions: '6 × 3 × 3',
      stackable: 'Yes',
      fragile: 'No',
      specialHandling: '',
      freightValue: '₹1500',
      netProfit: '₹1200',
      routeNote: '',
      extraDistance: 0,
      extraEarnings: '₹0',
      spaceAvailable: '70%',
      updatedTotalEarnings: '₹1200',
      id: 'load-003',
      originLat: 13.0827,
      originLng: 80.2707,
      weightKg: 1000,
    );

    test('builds correct payload with valid loads only', () {
      final payload = repository.buildDeadheadPayload(
        loads: [completeLoad, incompleteLoad],
        driverLat: 23.0225,
        driverLng: 72.5714,
        truckMaxWeightKg: 9000,
        truckMaxLengthM: 6.0,
        truckMaxWidthM: 2.4,
        truckMaxHeightM: 2.4,
        arrivalTime: '2026-07-20T18:00:00Z',
      );

      expect(payload['driver_destination']['lat'], 23.0225);
      expect(payload['driver_destination']['lng'], 72.5714);
      expect(payload['truck_specs']['max_weight_kg'], 9000);
      expect(payload['truck_specs']['max_length_m'], 6.0);
      expect(payload['truck_specs']['max_width_m'], 2.4);
      expect(payload['truck_specs']['max_height_m'], 2.4);
      expect(payload['arrival_time'], '2026-07-20T18:00:00Z');

      final availableLoads =
          payload['available_loads'] as List<Map<String, dynamic>>;
      expect(availableLoads.length, 1);
      expect(availableLoads[0]['load_id'], 'load-001');
    });

    test('excludes loads without complete deadhead data', () {
      final payload = repository.buildDeadheadPayload(
        loads: [completeLoad, incompleteLoad],
        driverLat: 23.0225,
        driverLng: 72.5714,
        truckMaxWeightKg: 9000,
        truckMaxLengthM: 6.0,
        truckMaxWidthM: 2.4,
        truckMaxHeightM: 2.4,
        arrivalTime: '2026-07-20T18:00:00Z',
      );

      final availableLoads =
          payload['available_loads'] as List<Map<String, dynamic>>;
      expect(availableLoads.length, 1);
      expect(availableLoads.every((l) => l['load_id'] != 'load-002'), isTrue);
    });

    test('populates correct coordinate values from LoadOffer', () {
      final payload = repository.buildDeadheadPayload(
        loads: [completeLoad],
        driverLat: 23.0225,
        driverLng: 72.5714,
        truckMaxWeightKg: 9000,
        truckMaxLengthM: 6.0,
        truckMaxWidthM: 2.4,
        truckMaxHeightM: 2.4,
        arrivalTime: '2026-07-20T18:00:00Z',
      );

      final load =
          (payload['available_loads'] as List<Map<String, dynamic>>)[0];
      expect(load['origin_lat'], 21.1702);
      expect(load['origin_lng'], 72.8311);
      expect(load['dest_lat'], 26.9124);
      expect(load['dest_lng'], 75.7873);
    });

    test('populates correct cargo data from LoadOffer', () {
      final payload = repository.buildDeadheadPayload(
        loads: [completeLoad],
        driverLat: 23.0225,
        driverLng: 72.5714,
        truckMaxWeightKg: 9000,
        truckMaxLengthM: 6.0,
        truckMaxWidthM: 2.4,
        truckMaxHeightM: 2.4,
        arrivalTime: '2026-07-20T18:00:00Z',
      );

      final load =
          (payload['available_loads'] as List<Map<String, dynamic>>)[0];
      expect(load['weight_kg'], 6000);
      expect(load['length_m'], 4.0);
      expect(load['width_m'], 1.8);
      expect(load['height_m'], 1.8);
      expect(load['payment_inr'], 8220);
    });

    test('returns empty available_loads when all loads lack data', () {
      final payload = repository.buildDeadheadPayload(
        loads: [incompleteLoad],
        driverLat: 23.0225,
        driverLng: 72.5714,
        truckMaxWeightKg: 9000,
        truckMaxLengthM: 6.0,
        truckMaxWidthM: 2.4,
        truckMaxHeightM: 2.4,
        arrivalTime: '2026-07-20T18:00:00Z',
      );

      final availableLoads =
          payload['available_loads'] as List<Map<String, dynamic>>;
      expect(availableLoads, isEmpty);
    });

    test('excludes partial load with missing required deadhead fields', () {
      final payload = repository.buildDeadheadPayload(
        loads: [partialLoad],
        driverLat: 13.0827,
        driverLng: 80.2707,
        truckMaxWeightKg: 5000,
        truckMaxLengthM: 6.0,
        truckMaxWidthM: 2.4,
        truckMaxHeightM: 2.4,
        arrivalTime: '2026-07-20T18:00:00Z',
      );

      final availableLoads =
          payload['available_loads'] as List<Map<String, dynamic>>;
      // partialLoad lacks destinationLat/DestinationLng/paymentInr,
      // so hasDeadheadData is false and it must be excluded.
      expect(availableLoads, isEmpty);
    });

    test('handles load with optional dimension fields null gracefully', () {
      const loadWithNullDimensions = LoadOffer(
        route: 'Chennai → Bangalore',
        customer: 'Singh',
        company: 'Singh Logistics',
        goods: 'Auto Parts',
        pickup: 'Chennai',
        distanceFromDriver: '50 km',
        estimatedProfit: '₹1500',
        fuelCost: '₹200',
        tollCost: '₹100',
        capacityUsed: 0.3,
        truckFillLabel: '30%',
        sharingTruckWith: '—',
        badgeLabel: 'Available',
        badgeEmoji: '📦',
        routeDistance: '350 km',
        routeDuration: '6h',
        weight: '1 tonne',
        dimensions: '6 × 3 × 3',
        stackable: 'Yes',
        fragile: 'No',
        specialHandling: '',
        freightValue: '₹1500',
        netProfit: '₹1200',
        routeNote: '',
        extraDistance: 0,
        extraEarnings: '₹0',
        spaceAvailable: '70%',
        updatedTotalEarnings: '₹1200',
        id: 'load-004',
        originLat: 13.0827,
        originLng: 80.2707,
        destinationLat: 12.9716,
        destinationLng: 77.5946,
        weightKg: 1000,
        paymentInr: 1500,
      );

      final payload = repository.buildDeadheadPayload(
        loads: [loadWithNullDimensions],
        driverLat: 13.0827,
        driverLng: 80.2707,
        truckMaxWeightKg: 5000,
        truckMaxLengthM: 6.0,
        truckMaxWidthM: 2.4,
        truckMaxHeightM: 2.4,
        arrivalTime: '2026-07-20T18:00:00Z',
      );

      final availableLoads =
          payload['available_loads'] as List<Map<String, dynamic>>;
      expect(availableLoads.length, 1);
      final load = availableLoads[0];
      expect(load['load_id'], 'load-004');
      expect(load['origin_lat'], 13.0827);
      expect(load['origin_lng'], 80.2707);
      expect(load['dest_lat'], 12.9716);
      expect(load['dest_lng'], 77.5946);
      expect(load['weight_kg'], 1000);
      expect(load['payment_inr'], 1500);
      // length_m, width_m, height_m default to 0.0 when null
      expect(load['length_m'], 0.0);
      expect(load['width_m'], 0.0);
      expect(load['height_m'], 0.0);
    });

    test('does NOT include 0.0 placeholder values for missing data', () {
      final payload = repository.buildDeadheadPayload(
        loads: [completeLoad],
        driverLat: 23.0225,
        driverLng: 72.5714,
        truckMaxWeightKg: 9000,
        truckMaxLengthM: 6.0,
        truckMaxWidthM: 2.4,
        truckMaxHeightM: 2.4,
        arrivalTime: '2026-07-20T18:00:00Z',
      );

      final load =
          (payload['available_loads'] as List<Map<String, dynamic>>)[0];
      // Verify real values are sent, not hardcoded 0.0
      expect(load['origin_lat'], isNot(0.0));
      expect(load['origin_lng'], isNot(0.0));
      expect(load['dest_lat'], isNot(0.0));
      expect(load['dest_lng'], isNot(0.0));
      expect(load['weight_kg'], isNot(0.0));
      expect(load['payment_inr'], isNot(0.0));
    });

    test('returns empty list for empty loads input', () {
      final payload = repository.buildDeadheadPayload(
        loads: [],
        driverLat: 23.0225,
        driverLng: 72.5714,
        truckMaxWeightKg: 9000,
        truckMaxLengthM: 6.0,
        truckMaxWidthM: 2.4,
        truckMaxHeightM: 2.4,
        arrivalTime: '2026-07-20T18:00:00Z',
      );

      final availableLoads =
          payload['available_loads'] as List<Map<String, dynamic>>;
      expect(availableLoads, isEmpty);
    });
  });
}
