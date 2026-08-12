import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/earnings_daily_model.dart';
import 'package:truxify_driver/theme/app_theme.dart';
import 'package:truxify_driver/widgets/home/driver_status_sheet.dart';

Widget _buildTestApp({required Widget child}) {
  return MaterialApp(
    theme: TruxifyTheme.light(),
    home: Scaffold(body: child),
  );
}

void main() {
  group('DriverStatusSheet battery display', () {
    testWidgets('shows battery level when provided', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _buildTestApp(
          child: DriverStatusSheet(
            isOnline: true,
            isLoadingLocation: false,
            currentLocationLabel: 'Mumbai',
            isLoadingMetrics: false,
            metricsError: null,
            todayEarnings: EarningsDailyModel(
              dayDate: DateTime.now(),
              amount: 5000,
              hoursDriven: 8.0,
              tripCount: 3,
            ),
            driverRating: 4.5,
            onToggleOnline: () {},
            batteryLevel: 75,
            isCharging: false,
          ),
        ),
      );

      expect(find.text('75%'), findsOneWidget);
    });

    testWidgets('shows charging state when charging', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _buildTestApp(
          child: DriverStatusSheet(
            isOnline: true,
            isLoadingLocation: false,
            currentLocationLabel: 'Delhi',
            isLoadingMetrics: false,
            metricsError: null,
            todayEarnings: EarningsDailyModel(
              dayDate: DateTime.now(),
              amount: 3000,
              hoursDriven: 5.0,
              tripCount: 2,
            ),
            driverRating: 4.8,
            onToggleOnline: () {},
            batteryLevel: 90,
            isCharging: true,
          ),
        ),
      );

      expect(find.text('90% · Charging'), findsOneWidget);
    });

    testWidgets('hides battery row when batteryLevel is null', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _buildTestApp(
          child: DriverStatusSheet(
            isOnline: true,
            isLoadingLocation: false,
            currentLocationLabel: 'Chennai',
            isLoadingMetrics: false,
            metricsError: null,
            todayEarnings: EarningsDailyModel(
              dayDate: DateTime.now(),
              amount: 2000,
              hoursDriven: 4.0,
              tripCount: 1,
            ),
            driverRating: null,
            onToggleOnline: () {},
          ),
        ),
      );

      expect(find.byIcon(Icons.battery_5_bar_rounded), findsNothing);
    });

    testWidgets('shows critical color for low battery', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _buildTestApp(
          child: DriverStatusSheet(
            isOnline: true,
            isLoadingLocation: false,
            currentLocationLabel: 'Pune',
            isLoadingMetrics: false,
            metricsError: null,
            todayEarnings: null,
            driverRating: null,
            onToggleOnline: () {},
            batteryLevel: 8,
          ),
        ),
      );

      final textWidget = tester.widget<Text>(
        find.text('8%'),
      );
      expect(textWidget.style?.color, TruxifyColors.errorRed);
    });

    testWidgets('shows warning color for low battery', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _buildTestApp(
          child: DriverStatusSheet(
            isOnline: true,
            isLoadingLocation: false,
            currentLocationLabel: 'Bangalore',
            isLoadingMetrics: false,
            metricsError: null,
            todayEarnings: null,
            driverRating: null,
            onToggleOnline: () {},
            batteryLevel: 15,
          ),
        ),
      );

      final textWidget = tester.widget<Text>(
        find.text('15%'),
      );
      expect(textWidget.style?.color, TruxifyColors.warning);
    });

    testWidgets('shows charging icon when charging', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _buildTestApp(
          child: DriverStatusSheet(
            isOnline: true,
            isLoadingLocation: false,
            currentLocationLabel: 'Hyderabad',
            isLoadingMetrics: false,
            metricsError: null,
            todayEarnings: null,
            driverRating: null,
            onToggleOnline: () {},
            batteryLevel: 50,
            isCharging: true,
          ),
        ),
      );

      expect(find.byIcon(Icons.battery_charging_full_rounded), findsOneWidget);
    });

    testWidgets('shows success color for healthy battery', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _buildTestApp(
          child: DriverStatusSheet(
            isOnline: true,
            isLoadingLocation: false,
            currentLocationLabel: 'Kolkata',
            isLoadingMetrics: false,
            metricsError: null,
            todayEarnings: null,
            driverRating: null,
            onToggleOnline: () {},
            batteryLevel: 85,
          ),
        ),
      );

      final textWidget = tester.widget<Text>(
        find.text('85%'),
      );
      expect(textWidget.style?.color, TruxifyColors.success);
    });
  });
}
