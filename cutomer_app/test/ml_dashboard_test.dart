import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/screens/ml_dashboard.dart';

void main() {
  Widget buildDashboard(Map<String, dynamic>? metrics) {
    return MaterialApp(home: Scaffold(body: MLDashboard(initialMetrics: metrics)));
  }

  testWidgets('renders safely when metrics is null', (tester) async {
    await tester.pumpWidget(buildDashboard(null));
    expect(tester.takeException(), isNull);
    expect(find.text('No metrics available'), findsWidgets);
  });

  testWidgets('renders safely when results is a List (not a Map)', (tester) async {
    await tester.pumpWidget(buildDashboard({
      'results': [
        {'production': 0.1, 'shadow': 0.2}
      ]
    }));
    expect(tester.takeException(), isNull);
    expect(find.text('No metrics available'), findsWidgets);
  });

  testWidgets('skips metrics whose production/shadow are non-numeric',
      (tester) async {
    await tester.pumpWidget(buildDashboard({
      'results': {
        'rmse': {'production': 1, 'shadow': 2},
        'accuracy': {'production': 'N/A', 'shadow': 'N/A'},
        'latency': {'production': 10},
        'throughput': {'shadow': 20},
      }
    }));
    expect(tester.takeException(), isNull);
    // Only the numeric rmse row is rendered.
    expect(find.text('Prod: 1.00'), findsOneWidget);
    expect(find.text('Shadow: 2.00'), findsOneWidget);
    // Non-numeric rows must not produce formatted values.
    expect(find.text('Prod: N/A'), findsNothing);
    expect(find.text('No metrics available'), findsNothing);
  });

  testWidgets('renders valid numeric metrics with formatting', (tester) async {
    await tester.pumpWidget(buildDashboard({
      'results': {
        'rmse': {'production': 3.14159, 'shadow': 2.71828},
      }
    }));
    expect(tester.takeException(), isNull);
    expect(find.text('Prod: 3.14'), findsOneWidget);
    expect(find.text('Shadow: 2.72'), findsOneWidget);
  });
}
