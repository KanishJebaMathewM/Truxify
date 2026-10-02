import 'package:flutter_test/flutter_test.dart';
import '../lib/models/route_stop_model.dart';
import '../lib/services/route_optimization_service.dart';

void main() {
  test('uses the previously selected stop as the next distance reference', () async {
    final service = RouteOptimizationService();
    final window = DateTime(2026, 1, 1, 8);

    final stops = [
      RouteStop(
        id: 'b',
        address: 'B',
        latitude: 0,
        longitude: 1,
        deliveryWindowStart: window,
        deliveryWindowEnd: window.add(const Duration(hours: 2)),
      ),
      RouteStop(
        id: 'c',
        address: 'C',
        latitude: 0,
        longitude: 1.9,
        deliveryWindowStart: window,
        deliveryWindowEnd: window.add(const Duration(hours: 2)),
      ),
      RouteStop(
        id: 'd',
        address: 'D',
        latitude: 1,
        longitude: 0.5,
        deliveryWindowStart: window,
        deliveryWindowEnd: window.add(const Duration(hours: 2)),
      ),
    ];

    final result = await service.optimizeRoute(stops, 0, 0);

    expect(result.map((stop) => stop.id).toList(), ['b', 'c', 'd']);
  });
}
