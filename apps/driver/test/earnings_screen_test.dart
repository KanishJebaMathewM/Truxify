import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/controllers/app_controller.dart';
import 'package:truxify_driver/screens/earnings_screen.dart';
import 'package:truxify_driver/theme/app_theme.dart';
import 'package:truxify_driver/widgets/earnings_shimmer.dart';

Widget _buildTestEarningsApp() {
  final controller = TruxifyController();

  return TruxifyScope(
    controller: controller,
    child: MaterialApp(
      theme: TruxifyTheme.light(),
      darkTheme: TruxifyTheme.dark(),
      home: const Scaffold(
        body: EarningsScreen(),
      ),
    ),
  );
}

void main() {
  testWidgets('EarningsScreen shows shimmer skeletons initially', (WidgetTester tester) async {
    // Start pumping the widget without waiting for asynchronous operations to finish yet
    await tester.pumpWidget(_buildTestEarningsApp());

    // Shimmer skeletons should be visible in the initial loading state
    expect(find.byType(SummaryCardsShimmer), findsOneWidget);
    expect(find.byType(HeatmapCalendarShimmer), findsOneWidget);
    expect(find.byType(SelectedDateDetailsShimmer), findsOneWidget);
    expect(find.byType(PendingPaymentsShimmer), findsOneWidget);
  });

  testWidgets('EarningsScreen transitions from shimmer to content when load completes', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestEarningsApp());
    
    // Pump and wait for all asynchronous futures (loading data) to complete
    await tester.pumpAndSettle();

    // After loading completes (and artificial delay is bypassed), shimmer skeletons should disappear
    expect(find.byType(SummaryCardsShimmer), findsNothing);
    expect(find.byType(HeatmapCalendarShimmer), findsNothing);
    expect(find.byType(SelectedDateDetailsShimmer), findsNothing);
    expect(find.byType(PendingPaymentsShimmer), findsNothing);

    // The actual content widgets should now be present
    expect(find.text('Earning Calendar'), findsOneWidget);
    expect(find.text('Transaction History'), findsOneWidget);
  });
}
