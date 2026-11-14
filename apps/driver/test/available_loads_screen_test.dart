
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:truxify_driver/models/app_models.dart';
import 'package:truxify_driver/screens/available_loads_screen.dart';
import 'package:truxify_driver/services/marketplace_repository.dart';

// Fake repository for testing
class FakeMarketplaceRepository extends MarketplaceRepository {
  FakeMarketplaceRepository({
    this.loads = const [],
    this.shouldThrow = false,
  });

  final List<LoadOffer> loads;
  final bool shouldThrow;

  @override
  Future<List<LoadOffer>> fetchLoadOffers() async {
    if (shouldThrow) {
      throw Exception('Failed to fetch loads');
    }

    return loads;
  }
}

void main() {
  // Reusable widget setup
  Future<void> setupScreen(
    WidgetTester tester,
    MarketplaceRepository repository,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: AvailableLoadsScreen(repository: repository),
      ),
    );
  }

  group('Available Loads Screen Tests', () {

    // Test 1: Empty state
    testWidgets('shows empty state when no loads are available',
        (tester) async {
      final repository = FakeMarketplaceRepository();

      await setupScreen(tester, repository);
      await tester.pumpAndSettle();

      expect(find.text('No loads available'), findsOneWidget);

      expect(
        find.text(
          'New load offers will appear here as they become available.',
        ),
        findsOneWidget,
      );
    });

    // Test 2: Screen renders successfully
    testWidgets('renders Available Loads screen', (tester) async {
      final repository = FakeMarketplaceRepository();

      await setupScreen(tester, repository);
      await tester.pumpAndSettle();

      expect(find.byType(AvailableLoadsScreen), findsOneWidget);
    });

    // Test 3: Loading indicator
    testWidgets('shows loading indicator while fetching loads',
        (tester) async {
      final repository = FakeMarketplaceRepository();

      await setupScreen(tester, repository);

      // Check immediately after rendering, before async work settles.
      expect(find.byType(CircularProgressIndicator), findsWidgets);

      await tester.pumpAndSettle();
    });

    // Test 4: Handles repository errors
    testWidgets('handles repository errors without crashing',
        (tester) async {
      final repository = FakeMarketplaceRepository(
        shouldThrow: true,
      );

      await setupScreen(tester, repository);
      await tester.pumpAndSettle();

      expect(find.byType(AvailableLoadsScreen), findsOneWidget);
    });

  });
}
