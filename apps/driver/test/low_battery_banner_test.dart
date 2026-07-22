import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/theme/app_theme.dart';
import 'package:truxify_driver/widgets/home/low_battery_banner.dart';

Widget _buildTestApp({required Widget child}) {
  return MaterialApp(
    theme: TruxifyTheme.light(),
    home: Scaffold(body: child),
  );
}

void main() {
  group('LowBatteryBanner', () {
    testWidgets('shows low battery warning for level above 10', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _buildTestApp(
          child: const LowBatteryBanner(batteryLevel: 18, isCritical: false),
        ),
      );

      expect(find.text('Low battery (18%). Connect charger soon.'), findsOneWidget);
      expect(find.byIcon(Icons.battery_warning_rounded), findsOneWidget);
    });

    testWidgets('shows critical battery warning for level at or below 10', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _buildTestApp(
          child: const LowBatteryBanner(batteryLevel: 8, isCritical: true),
        ),
      );

      expect(
        find.text('Critical battery (8%). Connect charger immediately.'),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.battery_alert_rounded), findsOneWidget);
    });

    testWidgets('uses warning color for low battery', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _buildTestApp(
          child: const LowBatteryBanner(batteryLevel: 15, isCritical: false),
        ),
      );

      final container = tester.widget<Container>(
        find.ancestor(of: find.byType(Text), matching: find.byType(Container)).first,
      );
      final decoration = container.decoration as BoxDecoration?;
      expect(decoration?.color, TruxifyColors.warning);
    });

    testWidgets('uses error color for critical battery', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _buildTestApp(
          child: const LowBatteryBanner(batteryLevel: 5, isCritical: true),
        ),
      );

      final container = tester.widget<Container>(
        find.ancestor(of: find.byType(Text), matching: find.byType(Container)).first,
      );
      final decoration = container.decoration as BoxDecoration?;
      expect(decoration?.color, TruxifyColors.errorRed);
    });
  });
}
