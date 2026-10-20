import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_driver/core/app_routes.dart';
import 'package:truxify_driver/l10n/app_localizations.dart';
import 'package:truxify_driver/providers/text_scale_provider.dart';
import 'package:truxify_driver/screens/shell_screen.dart';
import 'package:truxify_driver/services/battery_service.dart';
import 'package:truxify_driver/theme/app_theme.dart';
import 'package:truxify_driver/controllers/app_controller.dart';

import 'setup/test_setup.dart';

Widget _buildTestApp() {
  final controller = TruxifyController();

  return TruxifyScope(
    controller: controller,
    child: ChangeNotifierProvider(
      create: (_) => TextScaleProvider(),
      child: MaterialApp(
        theme: TruxifyTheme.light(),
        // Shell tabs resolve AppLocalizations.of(context)! — provide delegates.
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const ShellScreen(),
      ),
    ),
  );
}

Future<void> _pumpTransition(WidgetTester tester) async {
  for (int i = 0; i < 15; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
  // HomeScreen's _withRetry backoff (1s+2s on the harness's failing API).
  await tester.pump(const Duration(seconds: 4));
}

/// TripsScreen (shell tab 1) subscribes a Supabase realtime channel whose
/// reconnect/heartbeat timers self-reschedule forever; BatteryService is a
/// process-wide singleton whose poll timer outlives the tree. Dispose, stop,
/// disconnect, and flush so no timer is pending at teardown.
Future<void> _disposeApp(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  BatteryService.instance.stopMonitoring();
  unawaited(Supabase.instance.client.realtime.disconnect());
  await tester.pump(const Duration(seconds: 15));
}

void main() {
  setUpAll(() async {
    await setupTestEnvironment();
  });
  testWidgets(
      'ShellScreen route factory falls back to error route on invalid tripDetail arguments',
      (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp());
    await _pumpTransition(tester);

    // Push tripDetail route with invalid arguments (a String instead of a Trip)
    final navigator =
        tester.state<NavigatorState>(find.byType(Navigator).at(1));
    navigator.pushNamed(AppRoutes.tripDetail, arguments: 'invalid_args');
    await _pumpTransition(tester);

    // The error route was localized — it now renders the generic 'Error' string.
    expect(find.text('Error'), findsWidgets);

    await _disposeApp(tester);
  });

  testWidgets(
      'ShellScreen route factory falls back to error route on invalid loadDetail arguments',
      (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp());
    await _pumpTransition(tester);

    // Push loadDetail route with invalid arguments (null)
    final navigator =
        tester.state<NavigatorState>(find.byType(Navigator).at(1));
    navigator.pushNamed(AppRoutes.loadDetail, arguments: null);
    await _pumpTransition(tester);

    // The error route was localized — it now renders the generic 'Error' string.
    expect(find.text('Error'), findsWidgets);

    await _disposeApp(tester);
  });

  testWidgets(
      'ShellScreen route factory falls back to error route on invalid loadPointDetail arguments',
      (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp());
    await _pumpTransition(tester);

    // Push loadPointDetail route with invalid arguments (null)
    final navigator =
        tester.state<NavigatorState>(find.byType(Navigator).at(1));
    navigator.pushNamed(AppRoutes.loadPointDetail, arguments: null);
    await _pumpTransition(tester);

    // The error route was localized — it now renders the generic 'Error' string.
    expect(find.text('Error'), findsWidgets);

    await _disposeApp(tester);
  });

  testWidgets(
      'ShellScreen preserves nested navigator routing state when switching tabs',
      (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp());
    await _pumpTransition(tester);

    // Switch to Profile tab
    final profileTab = find.text('Profile');
    expect(profileTab, findsOneWidget);
    await tester.tap(profileTab);
    await _pumpTransition(tester);

    // The Documents tile was removed from the Profile UI — push the route on
    // the tab's nested navigator directly (same pattern as the fallback tests).
    // Offstage tabs keep their navigators out of the tree — the active tab's
    // nested navigator is index 1 (0 is the root).
    final nestedNavigator =
        tester.state<NavigatorState>(find.byType(Navigator).at(1));
    nestedNavigator.pushNamed(AppRoutes.documents);
    await _pumpTransition(tester);

    // Verify DocumentsScreen is pushed and visible
    expect(find.text('My Documents'), findsOneWidget);

    // Switch back to Home tab
    final homeTab = find.text('Home');
    expect(homeTab, findsOneWidget);
    await tester.tap(homeTab);
    await _pumpTransition(tester);

    // DocumentsScreen should be hidden
    expect(find.text('My Documents'), findsNothing);

    // Switch back to Profile tab
    await tester.tap(profileTab);
    await _pumpTransition(tester);

    // DocumentsScreen should still be visible because state is preserved
    expect(find.text('My Documents'), findsOneWidget);

    await _disposeApp(tester);
  });
}
