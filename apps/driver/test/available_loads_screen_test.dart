import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:truxify_driver/models/app_models.dart';
import 'package:truxify_driver/screens/available_loads_screen.dart';
import 'package:truxify_driver/services/marketplace_repository.dart';

class FakeMarketplaceRepository extends MarketplaceRepository {
  FakeMarketplaceRepository(this.loads);

  final List<LoadOffer> loads;

  @override
  Future<List<LoadOffer>> fetchLoadOffers() async {
    return loads;
  }
}

void main() {
  testWidgets('shows empty state when no loads are available', (tester) async {
    final repository = FakeMarketplaceRepository([]);

    await tester.pumpWidget(
      MaterialApp(
        home: AvailableLoadsScreen(repository: repository),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('No loads available'), findsOneWidget);
  });
}