import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/controllers/app_controller.dart';
import 'package:truxify_driver/core/app_routes.dart';
import 'package:truxify_driver/screens/destination_picker_screen.dart';
import 'package:truxify_driver/screens/shell_screen.dart';
import 'package:truxify_driver/theme/app_theme.dart';

Widget _buildTestApp() {
  final controller = TruxifyController();

  return TruxifyScope(
    controller: controller,
    child: MaterialApp(
      theme: TruxifyTheme.light(),
      home: const ShellScreen(),
      onGenerateRoute: (settings) {
        if (settings.name == AppRoutes.destinationPicker) {
          final args = settings.arguments as DestinationPickerArgs?;
          return MaterialPageRoute<void>(
            builder: (_) => DestinationPickerScreen(
              title: args?.title ?? 'Select Destination',
              initialQuery: args?.initialQuery,
              initialPoint: args?.initialPoint,
            ),
          );
        }

        return MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: SizedBox.shrink()),
        );
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
  testWidgets('driver home shows a compact search bar and stats cards', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp());

    await _pumpTransition(tester);

    expect(find.text('Where are you heading?'), findsOneWidget);
    expect(find.text('Today\'s Pay'), findsOneWidget);
    expect(find.text('Shift Hours'), findsOneWidget);
  });

  testWidgets('driver home expands search and opens the destination picker', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp());

    await _pumpTransition(tester);

    final destinationTile = find.text('Where are you heading?').first;
    await tester.tap(destinationTile);
    await _pumpTransition(tester);

    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Where are you going?'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Surat');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await _pumpTransition(tester);

    expect(find.text('Search area, landmark, or city'), findsOneWidget);
    expect(find.text('Confirm Destination'), findsOneWidget);
  });
}
