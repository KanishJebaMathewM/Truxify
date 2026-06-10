import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truxify/controllers/app_controller.dart';
import 'package:truxify/models/app_models.dart';
import 'package:truxify/screens/find_trucks_screen.dart';
import 'package:truxify/screens/truck_results_screen.dart';
import 'package:truxify/widgets/common_widgets.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Widget createTestWidget(WidgetTester tester, {TruxifyController? controller}) {
    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final ctrl = controller ?? TruxifyController();
    return TruxifyScope(
      controller: ctrl,
      child: MaterialApp(
        home: const Scaffold(
          body: FindTrucksScreen(),
        ),
      ),
    );
  }

  Finder findTextFieldByLabel(String labelText) {
    return find.ancestor(
      of: find.text(labelText),
      matching: find.byType(TextFormField),
    );
  }

  testWidgets('booking form validates successfully with default valid inputs', (WidgetTester tester) async {
    await tester.pumpWidget(createTestWidget(tester));
    await tester.pumpAndSettle();

    // Verify initial values are loaded from mockDefaultRouteDraft
    expect(find.text('Surat, Gujarat'), findsOneWidget);
    expect(find.text('Jaipur, Rajasthan'), findsOneWidget);
    expect(find.text('3'), findsAtLeastNWidgets(1)); // Cargo weight tonnes

    // Click on Find Trucks button
    final findTrucksButton = find.byType(PrimaryButton);
    expect(findTrucksButton, findsOneWidget);
    await tester.tap(findTrucksButton);
    await tester.pumpAndSettle();

    // Verify it navigated to TruckResultsScreen
    expect(find.byType(TruckResultsScreen), findsOneWidget);
    expect(find.text('4 trucks found'), findsOneWidget);
  });

  testWidgets('missing pickup location shows error and prevents submission', (WidgetTester tester) async {
    await tester.pumpWidget(createTestWidget(tester));
    await tester.pumpAndSettle();

    final pickupFinder = findTextFieldByLabel('Pickup Location');
    expect(pickupFinder, findsOneWidget);

    // Set text controller directly since the field is read-only
    final TextFormField pickupField = tester.widget(pickupFinder);
    pickupField.controller?.text = '';
    await tester.pumpAndSettle();

    // Click Find Trucks
    await tester.tap(find.byType(PrimaryButton));
    await tester.pumpAndSettle();

    // Verify error is shown
    expect(find.text('Please select a pickup location.'), findsOneWidget);
    // Verify it did not navigate
    expect(find.byType(TruckResultsScreen), findsNothing);
  });

  testWidgets('missing drop location shows error and prevents submission', (WidgetTester tester) async {
    await tester.pumpWidget(createTestWidget(tester));
    await tester.pumpAndSettle();

    final dropFinder = findTextFieldByLabel('Drop Location');
    expect(dropFinder, findsOneWidget);

    // Set text controller directly since the field is read-only
    final TextFormField dropField = tester.widget(dropFinder);
    dropField.controller?.text = '';
    await tester.pumpAndSettle();

    // Click Find Trucks
    await tester.tap(find.byType(PrimaryButton));
    await tester.pumpAndSettle();

    // Verify error is shown
    expect(find.text('Please select a drop location.'), findsOneWidget);
    // Verify it did not navigate
    expect(find.byType(TruckResultsScreen), findsNothing);
  });

  testWidgets('identical pickup and drop locations show error and prevent submission', (WidgetTester tester) async {
    await tester.pumpWidget(createTestWidget(tester));
    await tester.pumpAndSettle();

    final pickupFinder = findTextFieldByLabel('Pickup Location');
    final dropFinder = findTextFieldByLabel('Drop Location');

    // Set them to the same value
    final TextFormField pickupField = tester.widget(pickupFinder);
    final TextFormField dropField = tester.widget(dropFinder);
    pickupField.controller?.text = 'Mumbai';
    dropField.controller?.text = 'Mumbai';
    await tester.pumpAndSettle();

    // Click Find Trucks
    await tester.tap(find.byType(PrimaryButton));
    await tester.pumpAndSettle();

    // Verify error is shown
    expect(find.text('Pickup and drop locations cannot be the same.'), findsAtLeastNWidgets(1));
    // Verify it did not navigate
    expect(find.byType(TruckResultsScreen), findsNothing);
  });

  testWidgets('empty weight shows error and prevents submission', (WidgetTester tester) async {
    await tester.pumpWidget(createTestWidget(tester));
    await tester.pumpAndSettle();

    final weightFinder = findTextFieldByLabel('Weight (t)');
    expect(weightFinder, findsOneWidget);

    // Enter empty weight
    await tester.enterText(weightFinder, '');
    await tester.pumpAndSettle();

    // Click Find Trucks
    await tester.tap(find.byType(PrimaryButton));
    await tester.pumpAndSettle();

    // Verify error is shown
    expect(find.text('Weight must be greater than 0.'), findsAtLeastNWidgets(1));
    // Verify it did not navigate
    expect(find.byType(TruckResultsScreen), findsNothing);
  });

  testWidgets('non-numeric weight shows error and prevents submission', (WidgetTester tester) async {
    await tester.pumpWidget(createTestWidget(tester));
    await tester.pumpAndSettle();

    final weightFinder = findTextFieldByLabel('Weight (t)');
    expect(weightFinder, findsOneWidget);

    // Enter invalid text
    await tester.enterText(weightFinder, 'abc');
    await tester.pumpAndSettle();

    // Click Find Trucks
    await tester.tap(find.byType(PrimaryButton));
    await tester.pumpAndSettle();

    // Verify error is shown
    expect(find.text('Please enter a valid numeric weight.'), findsAtLeastNWidgets(1));
    // Verify it did not navigate
    expect(find.byType(TruckResultsScreen), findsNothing);
  });

  testWidgets('weight below 0.1 tonnes shows error and prevents submission', (WidgetTester tester) async {
    await tester.pumpWidget(createTestWidget(tester));
    await tester.pumpAndSettle();

    final weightFinder = findTextFieldByLabel('Weight (t)');
    expect(weightFinder, findsOneWidget);

    // Enter weight < 0.1
    await tester.enterText(weightFinder, '0.05');
    await tester.pumpAndSettle();

    // Click Find Trucks
    await tester.tap(find.byType(PrimaryButton));
    await tester.pumpAndSettle();

    // Verify error is shown
    expect(find.text('Weight must be between 0.1 and 50 tonnes.'), findsAtLeastNWidgets(1));
    // Verify it did not navigate
    expect(find.byType(TruckResultsScreen), findsNothing);
  });

  testWidgets('weight above 50 tonnes shows error and prevents submission', (WidgetTester tester) async {
    await tester.pumpWidget(createTestWidget(tester));
    await tester.pumpAndSettle();

    final weightFinder = findTextFieldByLabel('Weight (t)');
    expect(weightFinder, findsOneWidget);

    // Enter weight > 50
    await tester.enterText(weightFinder, '55.5');
    await tester.pumpAndSettle();

    // Click Find Trucks
    await tester.tap(find.byType(PrimaryButton));
    await tester.pumpAndSettle();

    // Verify error is shown
    expect(find.text('Weight must be between 0.1 and 50 tonnes.'), findsAtLeastNWidgets(1));
    // Verify it did not navigate
    expect(find.byType(TruckResultsScreen), findsNothing);
  });

  testWidgets('past pickup date shows error and prevents submission', (WidgetTester tester) async {
    final controller = TruxifyController();
    final pastDraft = RouteDraft(
      pickup: 'Surat, Gujarat',
      drop: 'Jaipur, Rajasthan',
      dateLabel: '01 Jan 2025, 6:00 AM', // Past date (local time is June 2026)
      goodsType: 'Textile',
      weightTonnes: '3',
      dimensions: '12 × 6 × 6',
      stacked: true,
      fragile: false,
      requirements: const [],
    );
    controller.openFindTrucks(draft: pastDraft);

    await tester.pumpWidget(createTestWidget(tester, controller: controller));
    await tester.pumpAndSettle();

    // Click Find Trucks
    await tester.tap(find.byType(PrimaryButton));
    await tester.pumpAndSettle();

    // Verify error is shown
    expect(find.text('Please select a future pickup date.'), findsOneWidget);
    // Verify it did not navigate
    expect(find.byType(TruckResultsScreen), findsNothing);
  });
}
