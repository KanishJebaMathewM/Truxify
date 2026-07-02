import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Stub HomeScreen — replace with actual import
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Truxify')),
      body: Column(
        children: [
          const Text('Active Shipments'),
          ElevatedButton(
            key: const Key('book_truck_btn'),
            onPressed: () {},
            child: const Text('Book a Truck'),
          ),
          ElevatedButton(
            key: const Key('track_shipment_btn'),
            onPressed: () {},
            child: const Text('Track Shipment'),
          ),
        ],
      ),
    );
  }
}

void main() {
  group('HomeScreen Widget Tests', () {

    testWidgets('renders app title', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      expect(find.text('Truxify'), findsOneWidget);
    });

    testWidgets('renders Book a Truck CTA button', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      expect(find.byKey(const Key('book_truck_btn')), findsOneWidget);
      expect(find.text('Book a Truck'), findsOneWidget);
    });

    testWidgets('renders Track Shipment button', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      expect(find.byKey(const Key('track_shipment_btn')), findsOneWidget);
    });

    testWidgets('renders Active Shipments section', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      expect(find.text('Active Shipments'), findsOneWidget);
    });
  });
}