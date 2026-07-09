import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/widgets/map_markers.dart';
import 'package:truxify_driver/widgets/pulsing_location_dot.dart';

void main() {
  group('Live Tracking UI Components', () {
    testWidgets('RouteMarker renders correctly', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: RouteMarker(
              icon: Icons.local_shipping,
              fillColor: Colors.blue,
              shadowColor: Colors.black,
            ),
          ),
        ),
      );

      expect(find.byType(RouteMarker), findsOneWidget);
      expect(find.byIcon(Icons.local_shipping), findsOneWidget);
    });

    testWidgets('RouteCheckpointMarker renders correctly with label', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: RouteCheckpointMarker(label: 'Stop A'),
          ),
        ),
      );

      expect(find.byType(RouteCheckpointMarker), findsOneWidget);
      expect(find.text('Stop A'), findsOneWidget);
    });

    testWidgets('PulsingLocationDot renders inactive state correctly', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PulsingLocationDot(isActive: false),
          ),
        ),
      );

      expect(find.byType(PulsingLocationDot), findsOneWidget);
      expect(find.byType(AnimatedBuilder), findsNothing);
    });

    testWidgets('PulsingLocationDot renders active state correctly', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PulsingLocationDot(isActive: true),
          ),
        ),
      );

      expect(find.byType(PulsingLocationDot), findsOneWidget);
      expect(find.byType(AnimatedBuilder), findsOneWidget);
      
      // Stop the animation from running indefinitely so the test can finish
      await tester.pumpAndSettle();
    });
  });
}
