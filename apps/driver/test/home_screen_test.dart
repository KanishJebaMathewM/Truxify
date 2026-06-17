import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/controllers/app_controller.dart';
import 'package:truxify_driver/core/app_routes.dart';
import 'package:truxify_driver/models/app_models.dart';
import 'package:truxify_driver/screens/destination_picker_screen.dart';
import 'package:truxify_driver/screens/shell_screen.dart';
import 'package:truxify_driver/services/marketplace_repository.dart';
import 'package:truxify_driver/theme/app_theme.dart';

class FakeMarketplaceRepository extends MarketplaceRepository {
  final _controller = StreamController<LoadOffer>.broadcast();

  @override
  Stream<LoadOffer> subscribeToNewLoads() {
    return _controller.stream;
  }

  void emitLoad(LoadOffer load) {
    _controller.add(load);
  }

  void dispose() {
    _controller.close();
  }
}

Widget _buildTestApp({
  MarketplaceRepository? marketplaceRepo,
  String? mockLocationText,
}) {
  final controller = TruxifyController();

  return TruxifyScope(
    controller: controller,
    child: MaterialApp(
      theme: TruxifyTheme.light(),
      home: ShellScreen(
        marketplaceRepo: marketplaceRepo,
        mockLocationText: mockLocationText,
      ),
      onGenerateRoute: (settings) {
        if (settings.name == AppRoutes.destinationPicker) {
          final args = settings.arguments as DestinationPickerArgs?;
          return MaterialPageRoute<void>(
            builder: (_) => DestinationPickerScreen(
              title: args?.title ?? 'Select Destination',
              initialQuery: args?.initialQuery,
              initialPoint: args?.initialPoint,
            ),
          );
        }

        return MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: SizedBox.shrink()),
        );
      },
    ),
  );
}

Future<void> _pumpTransition(WidgetTester tester) async {
  for (int i = 0; i < 15; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

void main() {
  testWidgets('driver home shows a compact search bar and stats cards', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp());

    await _pumpTransition(tester);

    expect(find.text('Where are you heading?'), findsOneWidget);
    expect(find.text('Today\'s Pay'), findsOneWidget);
    expect(find.text('Shift Hours'), findsOneWidget);
  });

  testWidgets('driver home expands search and opens the destination picker', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp());

    await _pumpTransition(tester);

    final destinationTile = find.text('Where are you heading?').first;
    await tester.tap(destinationTile);
    await _pumpTransition(tester);

    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Where are you going?'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Surat');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await _pumpTransition(tester);

    expect(find.text('Search area, landmark, or city'), findsOneWidget);
    expect(find.text('Confirm Destination'), findsOneWidget);
  });

  testWidgets('realtime load offers inserts show notification banner and support navigate & close', (
    WidgetTester tester,
  ) async {
    final fakeRepo = FakeMarketplaceRepository();
    await tester.pumpWidget(_buildTestApp(marketplaceRepo: fakeRepo));
    await _pumpTransition(tester);

    expect(find.text('New Load Available!'), findsNothing);

    const mockLoad = LoadOffer(
      id: 'load-123',
      route: 'Chennai → Coimbatore',
      customer: 'Customer A',
      company: 'Company A',
      goods: 'Steel',
      pickup: 'Chennai Port',
      distanceFromDriver: '5 km',
      estimatedProfit: '₹18,500',
      fuelCost: '₹4,000',
      tollCost: '₹1,500',
      capacityUsed: 0.8,
      truckFillLabel: 'Capacity',
      sharingTruckWith: '—',
      badgeLabel: 'Available',
      badgeEmoji: '📦',
      routeDistance: '500 km',
      routeDuration: '9 hours',
      weight: '12 Tons',
      dimensions: '—',
      stackable: '—',
      fragile: '—',
      specialHandling: '',
      freightValue: '₹24,000',
      netProfit: '₹18,500',
      routeNote: '',
      extraDistance: 0,
      extraEarnings: '₹0',
      spaceAvailable: '—',
      updatedTotalEarnings: '—',
    );

    fakeRepo.emitLoad(mockLoad);
    await tester.pump();

    expect(find.text('New Load Available!'), findsOneWidget);
    expect(find.text('Chennai → Coimbatore'), findsOneWidget);
    expect(find.text('12 Tons Steel • ₹18,500'), findsOneWidget);

    final viewButton = find.byKey(const Key('realtime_notification_view_button'));
    expect(viewButton, findsOneWidget);
    await tester.tap(viewButton);
    await tester.pumpAndSettle();

    expect(find.text('New Load Available!'), findsNothing);
    fakeRepo.dispose();
  });

  testWidgets('notification banner dismisses when tapping close button', (
    WidgetTester tester,
  ) async {
    final fakeRepo = FakeMarketplaceRepository();
    await tester.pumpWidget(_buildTestApp(marketplaceRepo: fakeRepo));
    await _pumpTransition(tester);

    const mockLoad = LoadOffer(
      id: 'load-123',
      route: 'Chennai → Coimbatore',
      customer: 'Customer A',
      company: 'Company A',
      goods: 'Steel',
      pickup: 'Chennai Port',
      distanceFromDriver: '5 km',
      estimatedProfit: '₹18,500',
      fuelCost: '₹4,000',
      tollCost: '₹1,500',
      capacityUsed: 0.8,
      truckFillLabel: 'Capacity',
      sharingTruckWith: '—',
      badgeLabel: 'Available',
      badgeEmoji: '📦',
      routeDistance: '500 km',
      routeDuration: '9 hours',
      weight: '—',
      dimensions: '—',
      stackable: '—',
      fragile: '—',
      specialHandling: '',
      freightValue: '₹24,000',
      netProfit: '₹18,500',
      routeNote: '',
      extraDistance: 0,
      extraEarnings: '₹0',
      spaceAvailable: '—',
      updatedTotalEarnings: '—',
    );

    fakeRepo.emitLoad(mockLoad);
    await tester.pump();

    expect(find.text('New Load Available!'), findsOneWidget);
    expect(find.text('Steel • ₹18,500'), findsOneWidget);

    final closeButton = find.byKey(const Key('realtime_notification_close_button'));
    expect(closeButton, findsOneWidget);
    await tester.tap(closeButton);
    await tester.pump();

    expect(find.text('New Load Available!'), findsNothing);
    fakeRepo.dispose();
  });

  testWidgets('notification banner auto-dismisses after 6 seconds', (
    WidgetTester tester,
  ) async {
    final fakeRepo = FakeMarketplaceRepository();
    await tester.pumpWidget(_buildTestApp(marketplaceRepo: fakeRepo));
    await _pumpTransition(tester);

    const mockLoad = LoadOffer(
      id: 'load-123',
      route: 'Chennai → Coimbatore',
      customer: 'Customer A',
      company: 'Company A',
      goods: 'Steel',
      pickup: 'Chennai Port',
      distanceFromDriver: '5 km',
      estimatedProfit: '₹18,500',
      fuelCost: '₹4,000',
      tollCost: '₹1,500',
      capacityUsed: 0.8,
      truckFillLabel: 'Capacity',
      sharingTruckWith: '—',
      badgeLabel: 'Available',
      badgeEmoji: '📦',
      routeDistance: '500 km',
      routeDuration: '9 hours',
      weight: '—',
      dimensions: '—',
      stackable: '—',
      fragile: '—',
      specialHandling: '',
      freightValue: '₹24,000',
      netProfit: '₹18,500',
      routeNote: '',
      extraDistance: 0,
      extraEarnings: '₹0',
      spaceAvailable: '—',
      updatedTotalEarnings: '—',
    );

    fakeRepo.emitLoad(mockLoad);
    await tester.pump();

    expect(find.text('New Load Available!'), findsOneWidget);

    await tester.pump(const Duration(seconds: 6));

    expect(find.text('New Load Available!'), findsNothing);
    fakeRepo.dispose();
  });



  testWidgets('notification banner shows when driver region matches load route', (
    WidgetTester tester,
  ) async {
    final fakeRepo = FakeMarketplaceRepository();
    
    await tester.pumpWidget(_buildTestApp(
      marketplaceRepo: fakeRepo,
      mockLocationText: 'Chennai, Tamil Nadu, India',
    ));
    await _pumpTransition(tester);

    const mockLoadChennai = LoadOffer(
      id: 'load-chennai',
      route: 'Chennai → Coimbatore',
      customer: 'Customer A',
      company: 'Company A',
      goods: 'Steel',
      pickup: 'Chennai Port',
      distanceFromDriver: '5 km',
      estimatedProfit: '₹18,500',
      fuelCost: '₹4,000',
      tollCost: '₹1,500',
      capacityUsed: 0.8,
      truckFillLabel: 'Capacity',
      sharingTruckWith: '—',
      badgeLabel: 'Available',
      badgeEmoji: '📦',
      routeDistance: '500 km',
      routeDuration: '9 hours',
      weight: '—',
      dimensions: '—',
      stackable: '—',
      fragile: '—',
      specialHandling: '',
      freightValue: '₹24,000',
      netProfit: '₹18,500',
      routeNote: '',
      extraDistance: 0,
      extraEarnings: '₹0',
      spaceAvailable: '—',
      updatedTotalEarnings: '—',
    );

    fakeRepo.emitLoad(mockLoadChennai);
    await tester.pump();

    // Since driver is in Chennai, and route is "Chennai → Coimbatore", banner MUST show
    expect(find.text('New Load Available!'), findsOneWidget);
    fakeRepo.dispose();
  });

  testWidgets('notification banner does not show when driver region does not match load route', (
    WidgetTester tester,
  ) async {
    final fakeRepo = FakeMarketplaceRepository();

    await tester.pumpWidget(_buildTestApp(
      marketplaceRepo: fakeRepo,
      mockLocationText: 'Delhi, India',
    ));
    await _pumpTransition(tester);

    const mockLoadCoimbatore = LoadOffer(
      id: 'load-coimbatore',
      route: 'Chennai → Coimbatore',
      customer: 'Customer B',
      company: 'Company B',
      goods: 'Pipes',
      pickup: 'Chennai Port',
      distanceFromDriver: '500 km',
      estimatedProfit: '₹18,500',
      fuelCost: '₹4,000',
      tollCost: '₹1,500',
      capacityUsed: 0.8,
      truckFillLabel: 'Capacity',
      sharingTruckWith: '—',
      badgeLabel: 'Available',
      badgeEmoji: '📦',
      routeDistance: '500 km',
      routeDuration: '9 hours',
      weight: '—',
      dimensions: '—',
      stackable: '—',
      fragile: '—',
      specialHandling: '',
      freightValue: '₹24,000',
      netProfit: '₹18,500',
      routeNote: '',
      extraDistance: 0,
      extraEarnings: '₹0',
      spaceAvailable: '—',
      updatedTotalEarnings: '—',
    );

    fakeRepo.emitLoad(mockLoadCoimbatore);
    await tester.pump();

    // Since driver is in Delhi, but route is "Chennai → Coimbatore", banner MUST NOT show
    expect(find.text('Pipes • ₹18,500'), findsNothing);
    fakeRepo.dispose();
  });
}
