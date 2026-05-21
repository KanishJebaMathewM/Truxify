import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/screens/destination_picker_screen.dart';
import 'package:truxify_driver/theme/app_theme.dart';

Widget _buildTestApp() {
  return MaterialApp(
    theme: TruxifyTheme.light(),
    home: const DestinationPickerScreen(title: 'Select Destination'),
  );
}

Future<void> _pumpTransition(WidgetTester tester) async {
  for (int i = 0; i < 15; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

void main() {
  testWidgets('DestinationPickerScreen shows SnackBar on search network exception', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp());
    await _pumpTransition(tester);

    // Enter search text to trigger _onSearchChanged
    final textField = find.byType(TextField);
    expect(textField, findsOneWidget);
    await tester.enterText(textField, 'Mumbai');

    // Pump to pass the 350ms debounce timer and execute _searchPlaces
    await tester.pump(const Duration(milliseconds: 400));
    // Let the async tasks (HTTP request) complete and throw the exception
    await tester.pump();

    // Verify that a SnackBar is displayed containing "Search error:"
    expect(find.textContaining('Search error:'), findsOneWidget);
  });
}
