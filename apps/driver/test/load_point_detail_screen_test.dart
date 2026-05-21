import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/app_models.dart';
import 'package:truxify_driver/screens/load_point_detail_screen.dart';
import 'package:truxify_driver/theme/app_theme.dart';

const point1 = RouteMapPoint(
  id: '1',
  title: 'Point 1',
  subtitle: 'Subtitle 1',
  details: 'Details 1',
  progress: 0.5,
  claimed: false,
  icon: Icons.location_on,
  latitude: 12.34,
  longitude: 56.78,
);

const point2 = RouteMapPoint(
  id: '2',
  title: 'Point 2',
  subtitle: 'Subtitle 2',
  details: 'Details 2',
  progress: 0.8,
  claimed: true,
  icon: Icons.location_on,
  latitude: 23.45,
  longitude: 67.89,
);

class TestWrapper extends StatefulWidget {
  const TestWrapper({super.key});

  @override
  State<TestWrapper> createState() => _TestWrapperState();
}

class _TestWrapperState extends State<TestWrapper> {
  RouteMapPoint _point = point1;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      theme: TruxifyTheme.light(),
      home: Scaffold(
        body: Column(
          children: [
            Expanded(child: LoadPointDetailScreen(point: _point)),
            ElevatedButton(
              onPressed: () {
                setState(() {
                  _point = point2;
                });
              },
              child: const Text('Update Point'),
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _pumpTransition(WidgetTester tester) async {
  for (int i = 0; i < 15; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

void main() {
  testWidgets('LoadPointDetailScreen updates its local state when the point property changes', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const TestWrapper());
    await _pumpTransition(tester);

    // Verify initial values from point1 are displayed
    expect(find.text('Point 1'), findsOneWidget);
    expect(find.text('Subtitle 1'), findsOneWidget);
    expect(find.text('Details 1'), findsOneWidget);
    expect(find.text('Available'), findsOneWidget);

    // Tap button to update parent widget's point parameter to point2
    await tester.tap(find.text('Update Point'));
    await _pumpTransition(tester);

    // Verify values from point2 are now displayed
    expect(find.text('Point 2'), findsOneWidget);
    expect(find.text('Subtitle 2'), findsOneWidget);
    expect(find.text('Details 2'), findsOneWidget);
    expect(find.text('Claimed'), findsOneWidget);
  });
}
