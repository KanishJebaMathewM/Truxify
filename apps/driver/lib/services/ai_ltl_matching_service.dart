import 'dart:async';
import '../models/ai_ltl_matching_model.dart';

class AiLtlMatchingService {
  Future<TrailerCapacityState> findLtlMatches() async {
    // Simulate analyzing current trailer space and querying spot market
    await Future.delayed(const Duration(seconds: 2));

    return TrailerCapacityState(
      totalLinearFeet: 53.0,
      availableLinearFeet: 21.0, // 32 feet used
      totalWeightCapLbs: 45000.0,
      availableWeightLbs: 18000.0,
      recommendedMatches: [
        PartialLoadMatch(
          loadId: 'LTL-NY-PA-401',
          pickupCity: 'Newark, NJ',
          dropoffCity: 'Allentown, PA',
          requiredLinearFeet: 12.0,
          requiredWeightLbs: 8500.0,
          additionalPayoutUsd: 450.00,
          detourTimeHours: 0.8,
          matchScorePct: 98.5, // Perfect fit along the route
        ),
        PartialLoadMatch(
          loadId: 'LTL-NJ-OH-992',
          pickupCity: 'Elizabeth, NJ',
          dropoffCity: 'Cleveland, OH',
          requiredLinearFeet: 20.0,
          requiredWeightLbs: 17000.0,
          additionalPayoutUsd: 920.00,
          detourTimeHours: 1.5,
          matchScorePct: 92.0, // Almost maxes out remaining capacity
        ),
      ],
    );
  }
}
