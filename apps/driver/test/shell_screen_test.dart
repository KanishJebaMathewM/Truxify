import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/core/app_routes.dart';
import 'package:truxify_driver/screens/shell_screen.dart';
import 'package:truxify_driver/theme/app_theme.dart';
import 'package:truxify_driver/controllers/app_controller.dart';

Widget _buildTestApp() {
  final controller = TruxifyController();

  return TruxifyScope(
    controller: controller,
    child: MaterialApp(
      theme: TruxifyTheme.light(),
      home: const ShellScreen(),
    ),
  );
}

Future<void> _pumpTransition(WidgetTester tester) async {
  for (int i = 0; i < 15; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

void main() {
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

    expect(find.text('Error: Invalid route arguments'), findsOneWidget);
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

    expect(find.text('Error: Invalid route arguments'), findsOneWidget);
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

    expect(find.text('Error: Invalid route arguments'), findsOneWidget);
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

    // Locate and tap the Documents tile on the Profile page
    final documentsTile = find.text('Documents');
    expect(documentsTile, findsOneWidget);
    await tester.tap(documentsTile);
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
  });
}
