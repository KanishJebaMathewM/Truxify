import 'dart:async';
import '../models/platoon_match_model.dart';

class PlatooningCoordinatorService {
  /// Simulates querying nearby Truxify trucks heading in the same direction
  Future<List<PlatoonMatch>> findPlatoonPartners(String currentRoute) async {
    await Future.delayed(const Duration(seconds: 2));
    
    return [
      PlatoonMatch(
        matchId: 'PLT-8812',
        partnerDriverName: 'Sarah Jenkins',
        partnerCompany: 'Swift Transportation',
        highwayRoute: 'I-80 Westbound',
        distanceAheadMiles: 4.5,
        estimatedFuelSavingsPercent: 8.2,
        matchingMiles: 240, // They share the next 240 miles
      ),
      PlatoonMatch(
        matchId: 'PLT-9921',
        partnerDriverName: 'Marcus Cole',
        partnerCompany: 'Independent Owner Operator',
        highwayRoute: 'I-80 Westbound',
        distanceAheadMiles: -1.2, // He is behind us
        estimatedFuelSavingsPercent: 7.5,
        matchingMiles: 180,
      )
    ];
  }

  Future<bool> sendPlatoonRequest(String matchId) async {
    // Simulating sending a sync request to the other driver's app
    await Future.delayed(const Duration(seconds: 2));
    return true; // Simulate the other driver accepting
  }
}
