import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:truxify/screens/location_picker_screen.dart';
import 'package:truxify/theme/app_theme.dart';

void main() {
  group('LocationPickerScreen & LocationPickResult Unit Tests', () {
    test('LocationPickResult data model holds address and point correctly', () {
      const point = LatLng(19.0760, 72.8777);
      const address = 'Bhiwandi Warehouses, Mumbai, Maharashtra';

      const result = LocationPickResult(address: address, point: point);

      expect(result.address, equals(address));
      expect(result.point.latitude, equals(19.0760));
      expect(result.point.longitude, equals(72.8777));
    });

    testWidgets('LocationPickerScreen renders title, search input, and address card', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: TruxifyTheme.light(),
          home: const LocationPickerScreen(
            title: 'Set Pickup Location',
            initialQuery: 'Mumbai APMC Market',
            initialPoint: LatLng(19.0760, 72.8777),
          ),
        ),
      );

      await tester.pump();

      expect(find.text('Set Pickup Location'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Selected Address'), findsOneWidget);
      expect(find.text('Confirm Location'), findsOneWidget);
    });
  });
}
