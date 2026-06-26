import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/controllers/app_controller.dart';
import 'package:truxify_driver/core/app_routes.dart';
import 'package:truxify_driver/screens/login_screen.dart';
import 'package:truxify_driver/screens/shell_screen.dart';
import 'package:truxify_driver/theme/app_theme.dart';

import 'setup.dart';

Widget _buildTestApp() {
  final controller = TruxifyController();

  return TruxifyScope(
    controller: controller,
    child: MaterialApp(
      theme: TruxifyTheme.light(),
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
  );
}

Future<void> _pumpTransition(WidgetTester tester) async {
  for (int i = 0; i < 15; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

void main() {
  setUpAll(() async {
    await setupTests();
  });

  testWidgets('logout clears the shell stack and returns to login', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp());
    await _pumpTransition(tester);

    await tester.tap(find.text('Profile'));
    await _pumpTransition(tester);

    await tester.tap(find.text('Documents'));
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
  });
}
