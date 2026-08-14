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
      // length_m, width_m, height_m default to 1.0 when null so the payload
      // stays positive for the backend's positive-dimension schema.
      expect(load['length_m'], 1.0);
      expect(load['width_m'], 1.0);
      expect(load['height_m'], 1.0);
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

  group('MarketplaceRepository.rawDeadheadFields', () {
    test('maps a real load_offers row into ML deadhead fields', () {
      final fields = MarketplaceRepository.rawDeadheadFields(<String, dynamic>{
        'id': 'load-010',
        'pickup_lat': 21.1702,
        'pickup_lng': 72.8311,
        'drop_lat': 26.9124,
        'drop_lng': 75.7873,
        'weight': '3 tonnes',
        'dimensions': '12 × 6 × 6 ft',
        'freight_value': 822000,
        'fuel_cost': 50000,
        'toll_cost': 20000,
        'net_profit': 610000,
      });

      expect(fields.originLat, closeTo(21.1702, 0.000001));
      expect(fields.originLng, closeTo(72.8311, 0.000001));
      expect(fields.destLat, closeTo(26.9124, 0.000001));
      expect(fields.destLng, closeTo(75.7873, 0.000001));
      expect(fields.weightKg, 3000);
      expect(fields.lengthM, closeTo(12 * 0.3048, 0.000001));
      expect(fields.widthM, closeTo(6 * 0.3048, 0.000001));
      expect(fields.heightM, closeTo(6 * 0.3048, 0.000001));
      expect(fields.paymentInr, 8220);
    });

    test('falls back to legacy origin_*/weight_kg/payment_inr keys', () {
      final fields = MarketplaceRepository.rawDeadheadFields(<String, dynamic>{
        'id': 'load-011',
        'origin_lat': 13.0827,
        'origin_lng': 80.2707,
        'dest_lat': 12.9716,
        'dest_lng': 77.5946,
        'weight_kg': 5000,
        'length_m': 4.0,
        'width_m': 1.8,
        'height_m': 1.8,
        'payment_inr': 5000,
      });

      expect(fields.originLat, 13.0827);
      expect(fields.originLng, 80.2707);
      expect(fields.destLat, 12.9716);
      expect(fields.destLng, 77.5946);
      expect(fields.weightKg, 5000);
      expect(fields.lengthM, 4.0);
      expect(fields.widthM, 1.8);
      expect(fields.heightM, 1.8);
      expect(fields.paymentInr, 5000);
    });

    test('parses metric dimensions and kilogram weight', () {
      final fields = MarketplaceRepository.rawDeadheadFields(<String, dynamic>{
        'pickup_lat': 23.0225,
        'pickup_lng': 72.5714,
        'drop_lat': 26.9124,
        'drop_lng': 75.7873,
        'weight': '500 kg',
        'dimensions': '4.5 × 2 × 2',
        'freight_value': 250000,
      });

      expect(fields.weightKg, 500);
      expect(fields.lengthM, closeTo(4.5, 0.000001));
      expect(fields.widthM, 2.0);
      expect(fields.heightM, 2.0);
      expect(fields.paymentInr, 2500);
    });

    test('returns nulls for a row with no deadhead-relevant data', () {
      final fields = MarketplaceRepository.rawDeadheadFields(<String, dynamic>{
        'id': 'load-012',
        'pickup_address': 'Surat',
        'drop_address': 'Jaipur',
        'weight': 'unknown',
      });

      expect(fields.originLat, isNull);
      expect(fields.destLat, isNull);
      expect(fields.weightKg, isNull);
      expect(fields.lengthM, isNull);
      expect(fields.widthM, isNull);
      expect(fields.heightM, isNull);
      expect(fields.paymentInr, isNull);
    });
  });
}
