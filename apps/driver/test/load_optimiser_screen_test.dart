import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:truxify_driver/models/app_models.dart';
import 'package:truxify_driver/screens/available_loads_screen.dart';
import 'package:truxify_driver/screens/load_optimiser_screen.dart';
import 'package:truxify_driver/services/marketplace_repository.dart';

class FakeMarketplaceRepository extends MarketplaceRepository {
  FakeMarketplaceRepository({
    this.loads = const [],
    this.optimiseResponse,
  });

  final List<LoadOffer> loads;
  final Map<String, dynamic>? optimiseResponse;

  @override
  Future<List<LoadOffer>> fetchLoadOffers() async {
    return loads;
  }

  @override
  Future<Map<String, dynamic>> optimiseLoads({
    required double truckPayloadKg,
    required double truckVolumeM3,
    required List<Map<String, dynamic>> availableLoads,
    required List<double> driverLocation,
  }) async {
    return optimiseResponse ??
        {
          'success': true,
          'model_id': 16,
          'combinations': [
            {
              'combination_id': 'COMBO-1',
              'load_ids': ['L1', 'L2'],
              'loads': [
                {
                  'load_id': 'L1',
                  'weight_kg': 3000.0,
                  'volume_m3': 12.0,
                  'origin': [19.0760, 72.8777],
                  'destination': [18.5204, 73.8567],
                  'freight_amount': 8000.0,
                },
                {
                  'load_id': 'L2',
                  'weight_kg': 4000.0,
                  'volume_m3': 15.0,
                  'origin': [19.0330, 73.0297],
                  'destination': [18.5204, 73.8567],
                  'freight_amount': 10000.0,
                },
              ],
              'total_weight_kg': 7000.0,
              'total_volume_m3': 27.0,
              'weight_fill_percent': 70.0,
              'volume_fill_percent': 67.5,
              'payload_fill_percent': 70.0,
              'total_freight_amount': 18000.0,
              'estimated_distance_km': 185.0,
              'estimated_duration_hours': 4.1,
              'route_sequence': [
                {
                  'type': 'start',
                  'location': [19.0760, 72.8777],
                  'description': 'Driver Start',
                },
                {
                  'type': 'pickup',
                  'load_id': 'L1',
                  'location': [19.0760, 72.8777],
                  'description': 'Pickup L1',
                },
                {
                  'type': 'destination',
                  'load_id': 'L1',
                  'location': [18.5204, 73.8567],
                  'description': 'Deliver L1',
                },
              ],
              'score': 0.95,
              'recommendation_reason': 'High revenue multi-load combination',
            }
          ],
        };
  }
}

const _testLoad = LoadOffer(
  id: 'load_1',
  route: 'Mumbai → Pune',
  customer: 'Acme Logistics',
  company: 'Tata Steel',
  goods: 'Steel Rods',
  pickup: 'Andheri West',
  distanceFromDriver: '5 km',
  estimatedProfit: '₹14,500',
  fuelCost: '₹3,200',
  tollCost: '₹800',
  capacityUsed: 0.7,
  truckFillLabel: '70% full',
  sharingTruckWith: 'None',
  badgeLabel: 'High Profit',
  badgeEmoji: '⭐',
  routeDistance: '150 km',
  routeDuration: '3.5 hrs',
  weight: '7000 kg',
  dimensions: '18 x 7 x 7 ft',
  stackable: 'Yes',
  fragile: 'No',
  specialHandling: 'Tarpaulin',
  freightValue: '₹18,000',
  netProfit: '₹14,500',
  routeNote: 'Direct highway route',
  extraDistance: '0 km',
  extraEarnings: '₹0',
  spaceAvailable: '30%',
  updatedTotalEarnings: '₹18,000',
  originLat: 19.0760,
  originLng: 72.8777,
  destinationLat: 18.5204,
  destinationLng: 73.8567,
  weightKg: 7000.0,
  paymentInr: 18000.0,
);

void main() {
  group('LoadOptimiserScreen & Model #16 tests', () {
    testWidgets('AvailableLoadsScreen displays Optimise My Load button and navigates',
        (tester) async {
      final repository = FakeMarketplaceRepository(loads: [_testLoad]);

      await tester.pumpWidget(
        MaterialApp(
          home: AvailableLoadsScreen(repository: repository),
        ),
      );

      await tester.pumpAndSettle();

      // Check for Optimise My Load button
      expect(find.text('Optimise My Load'), findsAtLeastNWidgets(1));

      // Tap Optimise button
      await tester.tap(find.text('Optimise My Load').first);
      await tester.pumpAndSettle();

      // Should be on LoadOptimiserScreen
      expect(find.byType(LoadOptimiserScreen), findsOneWidget);
      expect(find.text('AI Load & Payload Optimiser'), findsOneWidget);
    });

    testWidgets('LoadOptimiserScreen displays combinations and accepts multi-stop booking',
        (tester) async {
      final repository = FakeMarketplaceRepository(loads: [_testLoad]);

      await tester.pumpWidget(
        MaterialApp(
          home: LoadOptimiserScreen(
            repository: repository,
            availableLoads: [_testLoad],
          ),
        ),
      );

      await tester.pumpAndSettle();

      // Verify combination details are displayed
      expect(find.text('COMBO-1'), findsOneWidget);
      expect(find.text('70.0% Fill'), findsOneWidget);
      expect(find.text('₹18000'), findsOneWidget);
      expect(find.text('185 km'), findsOneWidget);
      expect(find.text('High revenue multi-load combination'), findsOneWidget);

      // Verify Accept Multi-Stop Booking button exists
      final acceptButton = find.textContaining('Accept Multi-Stop Booking');
      expect(acceptButton, findsOneWidget);

      // Tap Accept
      await tester.tap(acceptButton);
      await tester.pumpAndSettle();

      // Confirm dialog appears
      expect(find.text('Accept Multi-Stop Load'), findsOneWidget);
      expect(find.text('Confirm Multi-Stop Booking'), findsOneWidget);

      // Confirm booking
      await tester.tap(find.text('Confirm Multi-Stop Booking'));
      await tester.pumpAndSettle();
    });
  });
}
