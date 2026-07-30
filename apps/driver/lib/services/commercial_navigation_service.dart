import 'dart:async';
import '../models/truck_profile_model.dart';

class CommercialNavigationService {
  /// Simulates querying a commercial routing API (like HERE Maps) that factors
  /// in truck dimensions and hazmat status to generate a safe route.
  Future<NavigationRoute> calculateSafeRoute(String origin, String destination, TruckProfile profile) async {
    // Simulate API latency
    await Future.delayed(const Duration(seconds: 2));

    List<String> hazardsAvoided = [];

    // Simulate routing logic
    if (profile.heightFeet > 13.0) {
      hazardsAvoided.add('Low Clearance Bridge (11ft 8in) on Main St');
    }
    
    if (profile.grossWeightLbs > 60000) {
      hazardsAvoided.add('Weight Restricted County Road (10 Tons)');
    }

    if (profile.hazmatClass != 'NONE') {
      hazardsAvoided.add('Downtown Tunnel (Hazmat Restricted)');
    }

    // A mock standard route would be 50 miles, but commercial routing might be longer
    // to avoid hazards.
    final penaltyMiles = hazardsAvoided.length * 5.5;

    return NavigationRoute(
      routeId: 'RTE-${DateTime.now().millisecondsSinceEpoch}',
      polylineEncoded: 'mock_polyline_data_here',
      distanceMiles: 45.0 + penaltyMiles,
      estimatedTimeMinutes: 55.0 + (penaltyMiles * 1.5),
      avoidedHazards: hazardsAvoided,
    );
  }
}
