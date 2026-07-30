import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/controllers/app_controller.dart';
import 'package:truxify_driver/theme/app_theme.dart';
import 'package:truxify_driver/widgets/earnings/withdraw_bottom_sheet.dart';

Widget _buildTestApp({required double confirmedBalanceRupees}) {
  final controller = TruxifyController();

  return TruxifyScope(
    controller: controller,
    child: MaterialApp(
      theme: TruxifyTheme.light(),
      darkTheme: TruxifyTheme.dark(),
      home: Builder(
        builder: (context) => Scaffold(
          body: ElevatedButton(
            onPressed: () => showWithdrawBottomSheet(
              context,
              confirmedBalanceRupees: confirmedBalanceRupees,
            ),
            child: const Text('Open Sheet'),
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('WithdrawBottomSheet renders balance card and amount field', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestApp(confirmedBalanceRupees: 500));

    await tester.tap(find.text('Open Sheet'));
    await tester.pumpAndSettle();

    expect(find.text('Withdraw Funds'), findsOneWidget);
    expect(find.text('Available Balance'), findsOneWidget);
    expect(find.text('₹500'), findsOneWidget);
    expect(find.byType(TextFormField), findsOneWidget);
  });

  testWidgets('Quick-fill chips are present', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestApp(confirmedBalanceRupees: 1000));

    await tester.tap(find.text('Open Sheet'));
    await tester.pumpAndSettle();

    expect(find.text('25%'), findsOneWidget);
    expect(find.text('50%'), findsOneWidget);
    expect(find.text('75%'), findsOneWidget);
    expect(find.text('Max'), findsOneWidget);
  });

  testWidgets('Quick-fill Max fills full balance', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestApp(confirmedBalanceRupees: 1000));

    await tester.tap(find.text('Open Sheet'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Max'));
    await tester.pumpAndSettle();

    expect(find.text('1000'), findsOneWidget);
  });

  testWidgets('Quick-fill 50% fills half balance', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestApp(confirmedBalanceRupees: 1000));

    await tester.tap(find.text('Open Sheet'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('50%'));
    await tester.pumpAndSettle();

    expect(find.text('500'), findsOneWidget);
  });

  testWidgets('Withdraw button is disabled when amount field is empty', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestApp(confirmedBalanceRupees: 500));

    await tester.tap(find.text('Open Sheet'));
    await tester.pumpAndSettle();

    final withdrawButton = find.widgetWithText(ElevatedButton, 'Withdraw');
    expect(withdrawButton, findsOneWidget);

    final elevatedBtn = tester.widget<ElevatedButton>(withdrawButton);
    expect(elevatedBtn.onPressed, isNull);
  });

  testWidgets('Withdraw button enabled after entering valid amount', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestApp(confirmedBalanceRupees: 500));

    await tester.tap(find.text('Open Sheet'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), '300');
    await tester.pumpAndSettle();

    final withdrawButton = find.widgetWithText(ElevatedButton, 'Withdraw');
    final elevatedBtn = tester.widget<ElevatedButton>(withdrawButton);
    expect(elevatedBtn.onPressed, isNotNull);
  });

  testWidgets('Cancel button pops sheet returning false', (WidgetTester tester) async {
    bool? result;
    await tester.pumpWidget(
      MaterialApp(
        theme: TruxifyTheme.light(),
        home: Builder(
          builder: (context) => Scaffold(
            body: ElevatedButton(
              onPressed: () async {
                result = await showWithdrawBottomSheet(
                  context,
                  confirmedBalanceRupees: 500,
                );
              },
              child: const Text('Open Sheet'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open Sheet'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    expect(result, false);
  });
}
