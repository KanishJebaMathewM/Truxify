import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:truxify_driver/screens/destination_picker_screen.dart';
import 'package:truxify_driver/theme/app_theme.dart';

Widget _buildTestApp({http.Client? client}) {
  return MaterialApp(
    theme: TruxifyTheme.light(),
    home: DestinationPickerScreen(title: 'Select Destination', client: client),
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
    final mockClient = MockClient((request) async {
      throw Exception('Simulated network error');
    });

    await tester.pumpWidget(_buildTestApp(client: mockClient));
    await _pumpTransition(tester);

    // Enter search text to trigger _onSearchChanged
    final textField = find.byType(TextField);
    expect(textField, findsOneWidget);
    await tester.enterText(textField, 'Mumbai');

    // Pump to pass the 350ms debounce timer and execute _searchPlaces
    await tester.pump(const Duration(milliseconds: 400));
    // Let the async tasks complete and throw the exception
    await tester.pump();

    // Verify that a SnackBar is displayed containing "Search error:"
    expect(find.textContaining('Search error:'), findsOneWidget);
  });
}
