import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/controllers/app_controller.dart';
import 'package:truxify_driver/core/app_routes.dart';
import 'package:truxify_driver/screens/login_screen.dart';
import 'package:truxify_driver/screens/shell_screen.dart';
import 'package:truxify_driver/theme/app_theme.dart';

import 'dart:async';

import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_driver/l10n/app_localizations.dart';
import 'package:truxify_driver/providers/text_scale_provider.dart';
import 'package:truxify_driver/services/battery_service.dart';

import 'setup.dart';

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
        initialRoute: AppRoutes.shell,
      onGenerateRoute: (settings) {
        switch (settings.name) {
          case AppRoutes.shell:
            return MaterialPageRoute<void>(
              builder: (_) => const ShellScreen(),
            );
          case AppRoutes.login:
            return MaterialPageRoute<void>(
              builder: (_) => const LoginScreen(),
            );
          default:
            return MaterialPageRoute<void>(
              builder: (_) => const Scaffold(body: SizedBox.shrink()),
            );
        }
        },
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
/// process-wide singleton whose poll timer outlives the tree.
Future<void> _disposeApp(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  BatteryService.instance.stopMonitoring();
  unawaited(Supabase.instance.client.realtime.disconnect());
  await tester.pump(const Duration(seconds: 15));
}

void main() {
  setUpAll(() async {
    await setupTests();
  });

  testWidgets(
      'logout clears the shell stack and returns to login',
      skip: true, // #17738: logout is unreachable — DriverProfileScreen (shell
      // profile tab) has no logout UI and the old ProfileScreen is unrouted.
      // Harness is fully repaired; un-skip once the product decision lands.
      (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp());
    await _pumpTransition(tester);

    await tester.tap(find.text('Profile'));
    await _pumpTransition(tester);

    // The Documents tile was removed from the Profile UI — push the route on
    // the active tab's nested navigator (same pattern as shell_screen_test).
    tester
        .state<NavigatorState>(find.byType(Navigator).at(1))
        .pushNamed(AppRoutes.documents);
    await _pumpTransition(tester);
    expect(find.text('My Documents'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await _pumpTransition(tester);

    // Scroll down to bring Logout tile into view
    await tester.drag(find.byType(ListView), const Offset(0, -500));
    await _pumpTransition(tester);

    expect(find.text('Logout'), findsOneWidget);

    await tester.tap(find.text('Logout'));
    await _pumpTransition(tester);
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Welcome, Driver'), findsOneWidget);
    expect(find.text('Logout'), findsNothing);
    expect(find.text('My Documents'), findsNothing);

    await tester.binding.handlePopRoute();
    await tester.pump();
    await tester.pump();

    expect(find.text('Welcome, Driver'), findsOneWidget);
    expect(find.text('Logout'), findsNothing);

    await _disposeApp(tester);
  });
}
