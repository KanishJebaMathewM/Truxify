import 'dart:async';
import '../models/ltl_consolidation_model.dart';

class LtlRecommendationEngine {
  /// Simulates an algorithm scanning the load board for smaller LTL shipments
  /// that perfectly fit the remaining space in a driver's trailer and align with their route.
  Future<List<LtlConsolidationLoad>> findAddOnLoads({
    required String currentOrigin,
    required String currentDestination,
    required double availableLinearFeet,
    required double availableWeightLbs,
  }) async {
    // Simulate complex algorithm scanning the database
    await Future.delayed(const Duration(seconds: 2));

    List<LtlConsolidationLoad> recommendations = [];

    // Simulate finding a highly compatible load
    if (availableLinearFeet >= 12.0 && availableWeightLbs >= 8000) {
      recommendations.add(LtlConsolidationLoad(
        loadId: 'LTL-ADD-881',
        origin: 'Springfield, IL',
        destination: 'Indianapolis, IN', // Along the way
        weightLbs: 6500,
        requiredLinearFeet: 10.0,
        addedRevenue: 450.00,
        detourMiles: 12.5,
        matchScore: 94.5,
      ));
    }

    // Simulate finding a moderately compatible load
    if (availableLinearFeet >= 20.0 && availableWeightLbs >= 15000) {
      recommendations.add(LtlConsolidationLoad(
        loadId: 'LTL-ADD-882',
        origin: 'Peoria, IL',
        destination: 'Columbus, OH',
        weightLbs: 12000,
        requiredLinearFeet: 18.0,
        addedRevenue: 850.00,
        detourMiles: 45.0,
        matchScore: 78.0,
      ));
    }

    // Sort by best match score
    recommendations.sort((a, b) => b.matchScore.compareTo(a.matchScore));

    return recommendations;
  }
}
