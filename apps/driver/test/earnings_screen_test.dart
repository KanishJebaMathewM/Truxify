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
    await tester.pumpWidget(_buildTestEarningsApp());

    expect(find.byType(SummaryCardsShimmer), findsOneWidget);
    expect(find.byType(HeatmapCalendarShimmer), findsOneWidget);
    expect(find.byType(SelectedDateDetailsShimmer), findsOneWidget);
    expect(find.byType(PendingPaymentsShimmer), findsOneWidget);
  });

  testWidgets('EarningsScreen transitions from shimmer to content when load completes', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestEarningsApp());

    await tester.pumpAndSettle();

    expect(find.byType(SummaryCardsShimmer), findsNothing);
    expect(find.byType(HeatmapCalendarShimmer), findsNothing);
    expect(find.byType(SelectedDateDetailsShimmer), findsNothing);
    expect(find.byType(PendingPaymentsShimmer), findsNothing);

    expect(find.text('Earning Calendar'), findsOneWidget);
    expect(find.text('Transaction History'), findsOneWidget);
  });

  testWidgets('EarningsScreen shows export download button in AppBar', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestEarningsApp());
    await tester.pumpAndSettle();

    expect(find.byTooltip('Export statement'), findsOneWidget);
    expect(find.byIcon(Icons.file_download_outlined), findsOneWidget);
  });

  testWidgets('Export button opens date range picker', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestEarningsApp());
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Export statement'));
    await tester.pumpAndSettle();

    expect(find.text('Select date range for statement'), findsOneWidget);
  });
}
