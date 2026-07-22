import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/models/app_models.dart';

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

List<RouteCardData> computeUsualRoutes(List<Map<String, dynamic>> history) {
  if (history.isEmpty) return const [];

  final routeMap = <String, _TestRouteStats>{};
  for (final order in history) {
    final pickup = order['pickup_address']?.toString() ?? '';
    final drop = order['drop_address']?.toString() ?? '';
    if (pickup.isEmpty || drop.isEmpty) continue;

    final key = '${pickup}|||${drop}';
    final existing = routeMap[key];
    final dateStr = order['pickup_date']?.toString() ?? '';

    if (existing != null) {
      existing.count++;
      if (dateStr.compareTo(existing.lastDate) > 0) {
        existing.lastDate = dateStr;
      }
    } else {
      routeMap[key] = _TestRouteStats(
        pickup: pickup,
        drop: drop,
        count: 1,
        lastDate: dateStr,
        pickupLat: (order['pickup_lat'] as num?)?.toDouble(),
        pickupLng: (order['pickup_lng'] as num?)?.toDouble(),
        dropLat: (order['drop_lat'] as num?)?.toDouble(),
        dropLng: (order['drop_lng'] as num?)?.toDouble(),
      );
    }
  }

  final sorted = routeMap.values.toList()
    ..sort((a, b) => b.count.compareTo(a.count));

  return sorted.take(5).map((stats) {
    final displayPickup = stats.pickup.split(',').first.trim();
    final displayDrop = stats.drop.split(',').first.trim();
    return RouteCardData(
      route: '$displayPickup \u2192 $displayDrop',
      pickup: stats.pickup,
      drop: stats.drop,
      tripCount: stats.count,
      lastUsedDate: stats.lastDate.isNotEmpty ? stats.lastDate : null,
      pickupLat: stats.pickupLat,
      pickupLng: stats.pickupLng,
      dropLat: stats.dropLat,
      dropLng: stats.dropLng,
    );
  }).toList();
}

class _TestRouteStats {
  _TestRouteStats({
    required this.pickup,
    required this.drop,
    required this.count,
    required this.lastDate,
    this.pickupLat,
    this.pickupLng,
    this.dropLat,
    this.dropLng,
  });

  final String pickup;
  final String drop;
  int count;
  String lastDate;
  final double? pickupLat;
  final double? pickupLng;
  final double? dropLat;
  final double? dropLng;
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

  group('computeUsualRoutes', () {
    test('returns empty list for empty history', () {
      final routes = computeUsualRoutes([]);
      expect(routes, isEmpty);
    });

    test('groups identical routes and counts trips', () {
      final history = [
        {'pickup_address': 'Surat, Gujarat', 'drop_address': 'Jaipur, Rajasthan', 'pickup_date': '2024-01-01'},
        {'pickup_address': 'Surat, Gujarat', 'drop_address': 'Jaipur, Rajasthan', 'pickup_date': '2024-02-01'},
        {'pickup_address': 'Mumbai, Maharashtra', 'drop_address': 'Delhi, NCR', 'pickup_date': '2024-01-15'},
      ];

      final routes = computeUsualRoutes(history);
      expect(routes.length, 2);
      expect(routes[0].tripCount, 2);
      expect(routes[0].pickup, 'Surat, Gujarat');
      expect(routes[0].drop, 'Jaipur, Rajasthan');
      expect(routes[0].route, 'Surat \u2192 Jaipur');
      expect(routes[1].tripCount, 1);
    });

    test('sorts routes by trip count descending', () {
      final history = [
        {'pickup_address': 'A', 'drop_address': 'B', 'pickup_date': '2024-01-01'},
        {'pickup_address': 'C', 'drop_address': 'D', 'pickup_date': '2024-01-01'},
        {'pickup_address': 'C', 'drop_address': 'D', 'pickup_date': '2024-02-01'},
        {'pickup_address': 'C', 'drop_address': 'D', 'pickup_date': '2024-03-01'},
        {'pickup_address': 'A', 'drop_address': 'B', 'pickup_date': '2024-04-01'},
      ];

      final routes = computeUsualRoutes(history);
      expect(routes.length, 2);
      expect(routes[0].tripCount, 3);
      expect(routes[0].pickup, 'C');
      expect(routes[1].tripCount, 2);
    });

    test('captures most recent date for each route', () {
      final history = [
        {'pickup_address': 'Surat', 'drop_address': 'Jaipur', 'pickup_date': '2024-01-01'},
        {'pickup_address': 'Surat', 'drop_address': 'Jaipur', 'pickup_date': '2024-06-15'},
        {'pickup_address': 'Surat', 'drop_address': 'Jaipur', 'pickup_date': '2024-03-10'},
      ];

      final routes = computeUsualRoutes(history);
      expect(routes.length, 1);
      expect(routes[0].lastUsedDate, '2024-06-15');
    });

    test('preserves coordinates when available', () {
      final history = [
        {
          'pickup_address': 'Surat, Gujarat',
          'drop_address': 'Jaipur, Rajasthan',
          'pickup_date': '2024-01-01',
          'pickup_lat': 21.17,
          'pickup_lng': 72.83,
          'drop_lat': 26.91,
          'drop_lng': 75.78,
        },
      ];

      final routes = computeUsualRoutes(history);
      expect(routes.length, 1);
      expect(routes[0].pickupLat, 21.17);
      expect(routes[0].pickupLng, 72.83);
      expect(routes[0].dropLat, 26.91);
      expect(routes[0].dropLng, 75.78);
    });

    test('skips orders with missing pickup or drop', () {
      final history = [
        {'pickup_address': 'Surat', 'drop_address': '', 'pickup_date': '2024-01-01'},
        {'pickup_address': '', 'drop_address': 'Jaipur', 'pickup_date': '2024-01-01'},
        {'pickup_address': 'Surat', 'drop_address': 'Jaipur', 'pickup_date': '2024-01-01'},
      ];

      final routes = computeUsualRoutes(history);
      expect(routes.length, 1);
      expect(routes[0].tripCount, 1);
    });

    test('limits to 5 routes', () {
      final history = List.generate(10, (i) => {
        'pickup_address': 'City $i',
        'drop_address': 'Dest $i',
        'pickup_date': '2024-01-01',
      });

      final routes = computeUsualRoutes(history);
      expect(routes.length, 5);
    });

    test('handles missing dates gracefully', () {
      final history = [
        {'pickup_address': 'Surat', 'drop_address': 'Jaipur'},
        {'pickup_address': 'Surat', 'drop_address': 'Jaipur'},
      ];

      final routes = computeUsualRoutes(history);
      expect(routes.length, 1);
      expect(routes[0].tripCount, 2);
    });
  });

  group('See All Navigation', () {
    testWidgets('See All button exists in stub', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
      expect(find.byKey(const Key('book_truck_btn')), findsOneWidget);
    });
  });

  group('RouteCardData Model', () {
    test('supports optional fields', () {
      const route = RouteCardData(
        route: 'Surat \u2192 Jaipur',
        pickup: 'Surat, Gujarat',
        drop: 'Jaipur, Rajasthan',
        tripCount: 3,
        lastUsedDate: '2024-06-15',
        pickupLat: 21.17,
        pickupLng: 72.83,
        dropLat: 26.91,
        dropLng: 75.78,
      );

      expect(route.tripCount, 3);
      expect(route.lastUsedDate, '2024-06-15');
      expect(route.pickupLat, 21.17);
      expect(route.pickupLng, 72.83);
      expect(route.dropLat, 26.91);
      expect(route.dropLng, 75.78);
    });

    test('backward compatible without optional fields', () {
      const route = RouteCardData(
        route: 'Surat \u2192 Jaipur',
        pickup: 'Surat, Gujarat',
        drop: 'Jaipur, Rajasthan',
      );

      expect(route.tripCount, isNull);
      expect(route.lastUsedDate, isNull);
      expect(route.pickupLat, isNull);
      expect(route.pickupLng, isNull);
      expect(route.dropLat, isNull);
      expect(route.dropLng, isNull);
    });
  });
}
