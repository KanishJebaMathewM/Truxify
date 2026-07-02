import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Stub DriverHomeScreen — replace with actual import
class DriverHomeScreen extends StatelessWidget {
  const DriverHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Driver Dashboard')),
      body: Column(
        children: [
          const Text("Today's Earnings"),
          const Text('Available Loads'),
          ElevatedButton(
            key: const Key('go_online_btn'),
            onPressed: () {},
            child: const Text('Go Online'),
          ),
          ElevatedButton(
            key: const Key('view_loads_btn'),
            onPressed: () {},
            child: const Text('View Loads'),
          ),
        ],
      ),
    );
  }
}

void main() {
  group('DriverHomeScreen Widget Tests', () {

    testWidgets('renders Driver Dashboard title', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DriverHomeScreen()));
      expect(find.text('Driver Dashboard'), findsOneWidget);
    });

    testWidgets("renders Today's Earnings section", (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DriverHomeScreen()));
      expect(find.text("Today's Earnings"), findsOneWidget);
    });

    testWidgets('renders Go Online button', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DriverHomeScreen()));
      expect(find.byKey(const Key('go_online_btn')), findsOneWidget);
    });

    testWidgets('renders View Loads button', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DriverHomeScreen()));
      expect(find.byKey(const Key('view_loads_btn')), findsOneWidget);
    });

    testWidgets('renders Available Loads section', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DriverHomeScreen()));
      expect(find.text('Available Loads'), findsOneWidget);
    });
  });
}