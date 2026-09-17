import 'package:flutter_test/flutter_test.dart';
import '../lib/models/route_stop_model.dart';
import '../lib/services/route_optimization_service.dart';

void main() {
  test('rejects a route that misses a delivery window end', () async {
    final service = RouteOptimizationService();
    final start = DateTime(2026, 1, 1, 8);

    final stops = [
      RouteStop(
        id: 'near',
        address: 'Near',
        latitude: 0,
        longitude: 0,
        deliveryWindowStart: start,
        deliveryWindowEnd: start.add(const Duration(minutes: 5)),
      ),
      RouteStop(
        id: 'far',
        address: 'Far',
        latitude: 0,
        longitude: 0.1,
        deliveryWindowStart: start,
        deliveryWindowEnd: start.add(const Duration(minutes: 10)),
      ),
    ];

    await expectLater(
      service.optimizeRoute(stops, 0, 0),
      throwsA(isA<StateError>()),
    );
  });
}
